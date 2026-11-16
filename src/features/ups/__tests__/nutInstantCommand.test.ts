// src/features/ups/__tests__/nutInstantCommand.test.ts

import { createServer, Server, Socket } from 'net';
import { createInterface } from 'readline';
import { nutCommandLine, parseUpsAddress, runNutInstantCommand } from '../nutInstantCommand';

describe('parseUpsAddress', () => {
  it.each([
    ['myups', { ups: 'myups', host: 'localhost', port: 3493 }],
    ['myups@localhost', { ups: 'myups', host: 'localhost', port: 3493 }],
    ['myups@nas.lan:3494', { ups: 'myups', host: 'nas.lan', port: 3494 }],
  ])('reads %j', (name, address) => {
    expect(parseUpsAddress(name)).toEqual(address);
  });

  it.each(['', '@localhost', 'myups@'])('refuses %j', (name) => {
    expect(() => parseUpsAddress(name)).toThrow(/Invalid NUT UPS name/);
  });
});

describe('nutCommandLine', () => {
  it('quotes every word and escapes quotes and backslashes', () => {
    expect(nutCommandLine(['PASSWORD', 'a "b" \\c'])).toBe('"PASSWORD" "a \\"b\\" \\\\c"\n');
  });

  it('refuses a line break, which would start another command', () => {
    expect(() => nutCommandLine(['PASSWORD', 'x\nINSTCMD ups load.off'])).toThrow(/line break/);
  });
});

/** A stand-in upsd on 127.0.0.1 that answers each line with the next canned reply. */
async function fakeUpsd(replies: string[]): Promise<{ server: Server; port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket: Socket) => {
    createInterface({ input: socket }).on('line', (line) => {
      received.push(line);
      const reply = replies.shift();
      if (reply !== undefined) socket.write(`${reply}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as { port: number }).port, received };
}

const credentials = { username: 'mqtt-agent', password: 'not-a-real-secret' };

describe('runNutInstantCommand', () => {
  it('logs in, runs the command and logs out', async () => {
    const upsd = await fakeUpsd(['OK', 'OK', 'OK', 'OK Goodbye']);
    await runNutInstantCommand(`myups@127.0.0.1:${upsd.port}`, 'test.battery.start.quick', credentials);
    await new Promise((resolve) => setTimeout(resolve, 20));
    upsd.server.close();
    expect(upsd.received).toEqual([
      '"USERNAME" "mqtt-agent"',
      '"PASSWORD" "not-a-real-secret"',
      '"INSTCMD" "myups" "test.battery.start.quick"',
      '"LOGOUT"',
    ]);
  });

  it("rejects with upsd's reason and sends nothing after a refusal", async () => {
    const upsd = await fakeUpsd(['OK', 'OK', 'ERR ACCESS-DENIED']);
    await expect(runNutInstantCommand(`myups@127.0.0.1:${upsd.port}`, 'load.off', credentials))
      .rejects.toThrow('upsd refused INSTCMD: ERR ACCESS-DENIED');
    upsd.server.close();
    expect(upsd.received).toHaveLength(3);
  });

  it('rejects when upsd is not running instead of waiting forever', async () => {
    const upsd = await fakeUpsd([]);
    const { port } = upsd;
    await new Promise((resolve) => upsd.server.close(resolve));
    await expect(runNutInstantCommand(`myups@127.0.0.1:${port}`, 'test.battery.start.quick', credentials))
      .rejects.toThrow(/ECONNREFUSED/);
  });

  it('rejects when upsd does not answer', async () => {
    const upsd = await fakeUpsd([]);
    await expect(runNutInstantCommand(`myups@127.0.0.1:${upsd.port}`, 'x', credentials, 100))
      .rejects.toThrow(/did not answer within 100 ms/);
    upsd.server.close();
  });
});
