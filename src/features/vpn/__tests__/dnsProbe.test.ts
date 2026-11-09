/**
 * Runs the real probe script against a stub DNS server on 127.0.0.1, bound to `lo`.
 * Loopback only: nothing leaves the host.
 */
import * as dgram from 'dgram';
import { AddressInfo } from 'net';
import { probeDns } from '../dnsProbe';

type Reply = (query: Buffer) => Buffer | undefined;

async function stubServer(reply: Reply): Promise<{ port: number; queries: Buffer[]; close(): void }> {
  const socket = dgram.createSocket('udp4');
  const queries: Buffer[] = [];
  socket.on('message', (msg, rinfo) => {
    queries.push(msg);
    const answer = reply(msg);
    if (answer) socket.send(answer, rinfo.port, rinfo.address);
  });
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve));
  return { port: (socket.address() as AddressInfo).port, queries, close: () => socket.close() };
}

/** The query's header echoed back with QR set and the given RCODE, no records. */
const answerWith = (rcode: number, idDelta = 0): Reply => query => {
  const out = Buffer.from(query);
  out.writeUInt16BE((query.readUInt16BE(0) + idDelta) & 0xffff, 0);
  out[2] |= 0x80;
  out[3] = (out[3] & 0xf0) | rcode;
  return out;
};

describe('probeDns (real python3, loopback stub)', () => {
  jest.setTimeout(15000);
  let stub: Awaited<ReturnType<typeof stubServer>> | undefined;
  afterEach(() => stub?.close());

  it('sends one root NS query and accepts an answer with its id', async () => {
    stub = await stubServer(answerWith(0));
    await expect(probeDns('lo', '127.0.0.1', stub.port)).resolves.toBeUndefined();
    expect(stub.queries).toHaveLength(1);
    const q = stub.queries[0];
    // RD flag, one question, root name, QTYPE NS, QCLASS IN.
    expect([...q.subarray(2, 6)]).toEqual([0x01, 0x00, 0x00, 0x01]);
    expect([...q.subarray(12)]).toEqual([0x00, 0x00, 0x02, 0x00, 0x01]);
  });

  it('any RCODE proves the tunnel carries traffic both ways', async () => {
    stub = await stubServer(answerWith(5)); // REFUSED
    await expect(probeDns('lo', '127.0.0.1', stub.port)).resolves.toBeUndefined();
  });

  it('silence → the reason, after the probe timeout', async () => {
    stub = await stubServer(() => undefined);
    await expect(probeDns('lo', '127.0.0.1', stub.port)).resolves.toMatch(/no answer from 127\.0\.0\.1 through lo: timed out/);
  });

  it('an answer with another id is not an answer', async () => {
    stub = await stubServer(answerWith(0, 1));
    await expect(probeDns('lo', '127.0.0.1', stub.port)).resolves.toMatch(/timed out/);
  });

  it('a device that does not exist → the reason', async () => {
    stub = await stubServer(answerWith(0));
    await expect(probeDns('nvnosuch0', '127.0.0.1', stub.port)).resolves.toMatch(/no answer.*through nvnosuch0/);
  });
});
