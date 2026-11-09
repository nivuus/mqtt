import * as execModule from '../../../utils/exec';
import { DNS_PROBE_TIMEOUT_S } from '../dnsProbe';
import { DEFAULT_GUEST_VPN_CONFIG } from '../nmProfileSettings';
import { checkTunnelHealth } from '../tunnelHealth';
import { fail, ok, Result } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;
const cfg = DEFAULT_GUEST_VPN_CONFIG;

const ROUTES_OK = JSON.stringify([
  { dst: 'default', dev: 'nvguest0', protocol: 'static', scope: 'link', metric: 50, flags: [] },
  { dst: '10.20.128.1', dev: 'nvguest0', protocol: 'static', scope: 'link', metric: 50, flags: [] },
]);
const RULES_OK = JSON.stringify([
  { priority: 0, src: 'all', table: 'local' },
  { priority: 99, src: 'all', iif: 'publicBridge', table: 'main', suppress_prefixlength: 0 },
  { priority: 100, src: 'all', iif: 'publicBridge', table: '200' },
  { priority: 101, src: 'all', oif: 'nvguest0', table: '200' },
  { priority: 32766, src: 'all', table: 'main' },
]);

describe('checkTunnelHealth', () => {
  let routes: Result;
  let rules: Result;
  let probe: Result;
  let calls: { file: string; args: string[]; input?: string; opts?: { timeoutMs?: number; quiet?: boolean } }[];

  beforeEach(() => {
    routes = ok(ROUTES_OK);
    rules = ok(RULES_OK);
    probe = ok();
    calls = [];
    mockedExec.execute_argv.mockImplementation(async (file, args, opts) => {
      calls.push({ file, args: [...args], opts });
      if (file === 'ip' && args.includes('route')) return routes;
      if (file === 'ip' && args.includes('rule')) return rules;
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
    mockedExec.execute_argv_input.mockImplementation(async (file, args, input, opts) => {
      calls.push({ file, args: [...args], input, opts });
      if (file === 'python3') return probe;
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
  });

  it('healthy: default route via the tun in table 200, rule 100, and the pushed DNS answers', async () => {
    await expect(checkTunnelHealth(cfg, ['10.20.128.1', '10.20.128.2'])).resolves.toBeUndefined();
    expect(calls.map(c => [c.file, ...c.args.slice(0, 5)])).toEqual([
      ['ip', '-j', '-4', 'route', 'show', 'table'],
      ['ip', '-j', '-4', 'rule', 'show'],
      ['python3', '-I', '-', 'nvguest0', '10.20.128.1', String(DNS_PROBE_TIMEOUT_S)],
    ]);
    expect(calls[0].args).toEqual(['-j', '-4', 'route', 'show', 'table', '200']);
  });

  it('runs every check quietly: they run on every tick', async () => {
    await checkTunnelHealth(cfg, ['10.20.128.1']);
    expect(calls.every(c => c.opts?.quiet === true)).toBe(true);
  });

  it('table 200 without a default route via the tun (OpenVPN reopened it) → unhealthy, no probe', async () => {
    routes = ok(JSON.stringify([{ dst: '10.20.128.1', dev: 'nvguest0', scope: 'link', flags: [] }]));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0 in table 200/);
    expect(calls.some(c => c.file === 'python3')).toBe(false);
  });

  it('an empty table 200 → unhealthy', async () => {
    routes = ok('[]');
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route/);
  });

  it('a default route in table 200 through another device → unhealthy', async () => {
    routes = ok(JSON.stringify([{ dst: 'default', gateway: '192.168.1.1', dev: 'enp5s0.832', flags: [] }]));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0/);
  });

  const route = (dst: string, dev = 'nvguest0') => ({ dst, dev, scope: 'link', flags: [] });

  it('healthy with the def1 shape: both 0.0.0.0/1 and 128.0.0.0/1 via the tun', async () => {
    routes = ok(JSON.stringify([route('0.0.0.0/1'), route('128.0.0.0/1'), route('10.20.128.1')]));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toBeUndefined();
  });

  it.each(['0.0.0.0/1', '128.0.0.0/1'])('only %s of the def1 pair → unhealthy', async half => {
    routes = ok(JSON.stringify([route(half)]));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0/);
  });

  it('the def1 pair through another device → unhealthy', async () => {
    routes = ok(JSON.stringify([route('0.0.0.0/1', 'enp5s0.832'), route('128.0.0.0/1', 'enp5s0.832')]));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no default route via nvguest0/);
  });

  it('python3 missing → "could not run python3", not a dead tunnel', async () => {
    probe = { stdout: '', stderr: '', exitCode: 1, spawnError: 'ENOENT' };
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/could not run python3: ENOENT/);
  });

  it('rule 100 missing → unhealthy', async () => {
    rules = ok(JSON.stringify(JSON.parse(RULES_OK).filter((r: { priority: number }) => r.priority !== 100)));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1']))
      .resolves.toMatch(/no rule "priority 100 iif publicBridge lookup 200"/);
  });

  it('rule 100 pointing to another table → unhealthy', async () => {
    rules = ok(RULES_OK.replace('"iif":"publicBridge","table":"200"', '"iif":"publicBridge","table":"main"'));
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/no rule/);
  });

  it('the pushed DNS does not answer through the tun → unhealthy with the reason', async () => {
    probe = fail('no answer from 10.20.128.1 through nvguest0: timed out');
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/DNS probe failed: no answer.*timed out/);
  });

  it('probes the first IPv4 DNS, skipping IPv6 entries', async () => {
    await checkTunnelHealth(cfg, ['fd00::1', '10.20.128.9']);
    const py = calls.find(c => c.file === 'python3')!;
    expect(py.args.slice(-4)).toEqual(['nvguest0', '10.20.128.9', String(DNS_PROBE_TIMEOUT_S), '53']);
    expect(py.opts?.timeoutMs).toBeGreaterThan(DNS_PROBE_TIMEOUT_S * 1000);
  });

  it('no IPv4 DNS pushed → unhealthy: nothing to probe and guest DNS cannot follow the tunnel', async () => {
    await expect(checkTunnelHealth(cfg, ['fd00::1'])).resolves.toMatch(/pushed no IPv4 DNS/);
    expect(calls.some(c => c.file === 'python3')).toBe(false);
  });

  it('the probe binds the socket to the device, never to a source address', async () => {
    await checkTunnelHealth(cfg, ['10.20.128.1']);
    const py = calls.find(c => c.file === 'python3')!;
    const script = py.input!;
    expect(script).toContain('SO_BINDTODEVICE');
    // The script goes on stdin, which exec never logs; argv carries only the parameters.
    expect(py.args.join(' ')).not.toContain('socket');
    expect(script).not.toMatch(/\.bind\(/);
  });

  it('ip failures are reported as unhealthy with the reason, not thrown', async () => {
    rules = fail('RTNETLINK answers: Operation not permitted');
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/ip rule.*Operation not permitted/);
  });

  it('unparsable ip output is reported', async () => {
    routes = ok('not json');
    await expect(checkTunnelHealth(cfg, ['10.20.128.1'])).resolves.toMatch(/ip route.*not valid JSON/);
  });
});
