import * as execModule from '../../../utils/exec';
import { parseRuleCommand, applyRule, moveInterface } from '../firewallRules';
import logger from '../../../utils/logger';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;
const ZONES = ['external', 'home', 'public'];

beforeEach(() => {
  jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  mockedExec.execute_argv.mockReset();
});

describe('parseRuleCommand', () => {
  it('accepts a service, a port and a forward', () => {
    expect(parseRuleCommand('{"id":"a1","op":"add","zone":"home","rule":{"kind":"service","service":"ssh"}}', ZONES))
      .toEqual({ id: 'a1', op: 'add', zone: 'home', rule: { kind: 'service', service: 'ssh' } });
    expect(parseRuleCommand('{"op":"remove","zone":"external","rule":{"kind":"port","port":"3478","protocol":"udp"}}', ZONES))
      .toMatchObject({ op: 'remove', rule: { kind: 'port', port: '3478', protocol: 'udp' } });
    expect(parseRuleCommand(JSON.stringify({ op: 'add', zone: 'external',
      rule: { kind: 'forward', port: '47984', protocol: 'tcp', toaddr: '192.168.3.2', toport: '47984', extra: 'x' } }), ZONES))
      .toMatchObject({ rule: { kind: 'forward', port: '47984', protocol: 'tcp', toaddr: '192.168.3.2', toport: '47984' } });
  });

  it.each([
    ['not json', 'json'],
    ['{"op":"flush","zone":"home","rule":{"kind":"service","service":"ssh"}}', 'op'],
    ['{"op":"add","zone":"nowhere","rule":{"kind":"service","service":"ssh"}}', 'zone'],
    ['{"op":"add","zone":"home","rule":{"kind":"service","service":"--reload"}}', 'service'],
    ['{"op":"add","zone":"home","rule":{"kind":"port","port":"70000","protocol":"tcp"}}', 'port'],
    ['{"op":"add","zone":"home","rule":{"kind":"port","port":"22","protocol":"icmp;"}}', 'protocol'],
    ['{"op":"add","zone":"home","rule":{"kind":"forward","port":"1","protocol":"tcp","toaddr":"1.2.3","toport":"1"}}', 'toaddr'],
    ['{"op":"add","zone":"home","rule":{"kind":"rich"}}', 'kind'],
  ])('refuses %s (%s)', (raw, error) => {
    expect(parseRuleCommand(raw, ZONES)).toMatchObject({ error });
  });
});

describe('applyRule', () => {
  const ok = { stdout: 'success', stderr: '', exitCode: 0 };

  it('writes the permanent configuration, then the runtime one, and never reloads', async () => {
    mockedExec.execute_argv.mockResolvedValue(ok);
    const result = await applyRule({ id: 'x', op: 'add', zone: 'external',
      rule: { kind: 'forward', port: '80', protocol: 'tcp', toaddr: '192.168.3.2', toport: '8080' } });
    expect(result).toMatchObject({ id: 'x', ok: true });
    expect(mockedExec.execute_argv.mock.calls.map((c) => c[1])).toEqual([
      ['--permanent', '--zone=external', '--add-forward-port=port=80:proto=tcp:toport=8080:toaddr=192.168.3.2'],
      ['--zone=external', '--add-forward-port=port=80:proto=tcp:toport=8080:toaddr=192.168.3.2'],
    ]);
  });

  it('reports a refused permanent write without touching the runtime', async () => {
    mockedExec.execute_argv.mockResolvedValueOnce({ stdout: '', stderr: 'Error: INVALID_SERVICE: nope', exitCode: 101 });
    const result = await applyRule({ id: 'y', op: 'add', zone: 'home', rule: { kind: 'service', service: 'nope' } });
    expect(result).toMatchObject({ ok: false, failed: 'permanent', detail: 'Error: INVALID_SERVICE: nope' });
    expect(mockedExec.execute_argv).toHaveBeenCalledTimes(1);
  });

  it('reports a runtime failure after a permanent success', async () => {
    mockedExec.execute_argv.mockResolvedValueOnce(ok).mockResolvedValueOnce({ stdout: '', stderr: 'FirewallD is not running', exitCode: 252 });
    const result = await applyRule({ id: 'z', op: 'remove', zone: 'home', rule: { kind: 'port', port: '22', protocol: 'tcp' } });
    expect(result).toMatchObject({ ok: false, failed: 'runtime', detail: 'FirewallD is not running' });
  });

  it('moves an interface with --change-interface', async () => {
    mockedExec.execute_argv.mockResolvedValue(ok);
    await expect(moveInterface('publicBridge', 'public')).resolves.toEqual({ ok: true });
    expect(mockedExec.execute_argv.mock.calls.map((c) => c[1])).toEqual([
      ['--permanent', '--zone=public', '--change-interface=publicBridge'],
      ['--zone=public', '--change-interface=publicBridge'],
    ]);
  });
});
