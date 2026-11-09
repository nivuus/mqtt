import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { writeDesiredEnabled } from '../desiredState';
import { DEFAULT_GUEST_VPN_CONFIG, GuestVpnConfig } from '../nmProfileSettings';
import { EXIT_IP_SERVICE, readGuestVpnStatus } from '../guestVpnStatus';
import { fail, ok, Result } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const ID = 'nivuus-guest-vpn';
const UUID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const VPN_DATA = 'vpn.data:ca = /root/.local/share/networkmanagement/certificates/nm-openvpn/nivuus-guest-vpn_a-ca.pem, '
  + 'connection-type = password, dev = nvguest0, dev-type = tun, ping-exit = 60, '
  + 'remote = nl-alk.zoogvpn.com\\:1194\\:udp, username = guest';

/** `nmcli -t -f vpn.data,GENERAL.STATE,VPN.VPN-STATE,IP4.DNS connection show uuid <u>` output. */
function details(active?: { general: string; vpn: string; dns?: string[] }): string {
  const lines = [VPN_DATA];
  if (active) {
    lines.push(`GENERAL.STATE:${active.general}`, `VPN.VPN-STATE:${active.vpn}`);
    (active.dns ?? []).forEach((d, i) => lines.push(`IP4.DNS[${i + 1}]:${d}`));
  }
  return `${lines.join('\n')}\n`;
}

describe('readGuestVpnStatus', () => {
  let dir: string;
  let cfg: GuestVpnConfig;
  let profiles: string[];
  let shown: string;
  let curl: Result;
  let calls: { file: string; args: string[]; timeoutMs?: number }[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guest-vpn-status-'));
    cfg = { ...DEFAULT_GUEST_VPN_CONFIG, stateFile: path.join(dir, 'guest-vpn.json') };
    profiles = [UUID];
    shown = details();
    curl = ok('5.255.103.96');
    calls = [];
    mockedExec.execute_argv.mockImplementation(async (file, args, opts) => {
      calls.push({ file, args: [...args], timeoutMs: opts?.timeoutMs });
      if (file === 'curl') return curl;
      if (args.includes('NAME,UUID')) {
        return ok(['bridge-publicBridge:ffffffff-0000-4000-8000-000000000000', ...profiles.map(u => `${ID}:${u}`)]
          .join('\n') + '\n');
      }
      if (args.includes('show') && args.includes('uuid')) return ok(shown);
      throw new Error(`unexpected ${file} ${args.join(' ')}`);
    });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const curlCalls = () => calls.filter(c => c.file === 'curl');

  it('no profile → no_config', async () => {
    profiles = [];
    await expect(readGuestVpnStatus(cfg)).resolves.toEqual({ state: 'no_config', dns: [] });
    expect(curlCalls()).toEqual([]);
  });

  it('several profiles with the live id → error naming them, owner action needed', async () => {
    profiles = [UUID, OTHER];
    const status = await readGuestVpnStatus(cfg);
    expect(status.state).toBe('error');
    expect(status.lastError).toContain(`2 profiles named ${ID}`);
    expect(status.lastError).toContain(UUID);
    expect(status.lastError).toContain(OTHER);
    expect(status.dns).toEqual([]);
  });

  it('profile, desired off, inactive → disabled with the remote', async () => {
    await writeDesiredEnabled(cfg.stateFile, false);
    await expect(readGuestVpnStatus(cfg)).resolves.toEqual({
      state: 'disabled', remote: 'nl-alk.zoogvpn.com:1194:udp', dns: [],
    });
    expect(curlCalls()).toEqual([]);
  });

  it('unescapes both the terse layer and the vpn.data option layer', async () => {
    // Value "a:1194:udp, b:1194:udp": vpn.data escapes ',' as '\,', then -t escapes ':' and '\'.
    shown = 'vpn.data:dev = nvguest0, remote = a\\:1194\\:udp\\\\, b\\:1194\\:udp, dev-type = tun\n';
    await expect(readGuestVpnStatus(cfg)).resolves.toMatchObject({ remote: 'a:1194:udp, b:1194:udp' });
  });

  it('a missing state file means desired off → disabled', async () => {
    await expect(readGuestVpnStatus(cfg)).resolves.toMatchObject({ state: 'disabled' });
  });

  it('queries the profile by UUID in terse mode', async () => {
    await readGuestVpnStatus(cfg);
    const show = calls.find(c => c.args.includes('uuid'))!;
    expect(show.args).toEqual(['-t', '-f', 'vpn.data,GENERAL.STATE,VPN.VPN-STATE,IP4.DNS', 'connection', 'show', 'uuid', UUID]);
  });

  it('activating → connecting', async () => {
    await writeDesiredEnabled(cfg.stateFile, true);
    shown = details({ general: 'activating', vpn: '3 - VPN connecting (prepare)' });
    await expect(readGuestVpnStatus(cfg)).resolves.toEqual({
      state: 'connecting', remote: 'nl-alk.zoogvpn.com:1194:udp', dns: [],
    });
    expect(curlCalls()).toEqual([]);
  });

  it('activated → connected with dns from IP4.DNS and remote from vpn.data', async () => {
    shown = details({ general: 'activated', vpn: '5 - VPN connected', dns: ['10.20.128.1', '10.20.128.2'] });
    await expect(readGuestVpnStatus(cfg)).resolves.toEqual({
      state: 'connected', remote: 'nl-alk.zoogvpn.com:1194:udp',
      dns: ['10.20.128.1', '10.20.128.2'], exitIp: '5.255.103.96',
    });
  });

  it('status maps failed activation to error', async () => {
    await writeDesiredEnabled(cfg.stateFile, true);
    const reason = 'Error: Connection activation failed: the VPN service returned invalid configuration';
    shown = details({ general: 'deactivating', vpn: '6 - VPN connection failed' });
    await expect(readGuestVpnStatus(cfg, reason)).resolves.toEqual({
      state: 'error', lastError: reason, remote: 'nl-alk.zoogvpn.com:1194:udp', dns: [],
    });
    // Once NM has dropped the failed profile, the recorded activation error still rules.
    shown = details();
    await expect(readGuestVpnStatus(cfg, reason)).resolves.toMatchObject({ state: 'error', lastError: reason });
    expect(curlCalls()).toEqual([]);
  });

  it('a failed VPN state without a recorded reason still reports error', async () => {
    shown = details({ general: 'activated', vpn: '6 - VPN connection failed' });
    const status = await readGuestVpnStatus(cfg);
    expect(status.state).toBe('error');
    expect(status.lastError).toMatch(/VPN connection failed/);
  });

  it('desired on but inactive without a recorded reason → error: guests are on the uplink', async () => {
    await writeDesiredEnabled(cfg.stateFile, true);
    const status = await readGuestVpnStatus(cfg);
    expect(status.state).toBe('error');
    expect(status.lastError).toMatch(/not active/);
  });

  it('desired off ignores a stale activation error → disabled', async () => {
    await writeDesiredEnabled(cfg.stateFile, false);
    await expect(readGuestVpnStatus(cfg, 'old failure')).resolves.toMatchObject({ state: 'disabled' });
  });

  it('exitIp read with curl --interface nvguest0 --max-time 10 only when connected', async () => {
    shown = details({ general: 'activated', vpn: '5 - VPN connected', dns: ['10.20.128.1'] });
    await readGuestVpnStatus(cfg);
    expect(curlCalls()).toHaveLength(1);
    const [c] = curlCalls();
    expect(c.args).toEqual(expect.arrayContaining(['--interface', 'nvguest0', '--max-time', '10', EXIT_IP_SERVICE]));
    expect(c.args[c.args.indexOf('--interface') + 1]).toBe('nvguest0');
    expect(c.args[c.args.indexOf('--max-time') + 1]).toBe('10');
    expect(EXIT_IP_SERVICE).toBe('https://api.ipify.org');
    expect(c.timeoutMs).toBeGreaterThan(10000);
  });

  it('exitIp absent and no throw when curl fails: error, never connected', async () => {
    shown = details({ general: 'activated', vpn: '5 - VPN connected', dns: ['10.20.128.1'] });
    curl = fail('curl: (28) Connection timed out after 10001 milliseconds');
    const status = await readGuestVpnStatus(cfg);
    expect(status.state).toBe('error');
    expect(status.exitIp).toBeUndefined();
    expect(status.lastError).toMatch(/active but carries no traffic.*no exit IP measured.*timed out/);
  });

  it('a non-IP body from the exit IP service: error, no exitIp', async () => {
    shown = details({ general: 'activated', vpn: '5 - VPN connected' });
    curl = ok('<html>captive portal</html>');
    const status = await readGuestVpnStatus(cfg);
    expect(status.state).toBe('error');
    expect(status.exitIp).toBeUndefined();
    expect(status.lastError).toMatch(/active but carries no traffic.*returned no IP address/);
  });

  it('VPN-STATE 5 while GENERAL.STATE is not activated is never connected', async () => {
    shown = details({ general: 'activating', vpn: '5 - VPN connected' });
    await expect(readGuestVpnStatus(cfg)).resolves.toMatchObject({ state: 'connecting' });
    expect(curlCalls()).toEqual([]);
  });

  it('nmcli failures propagate', async () => {
    mockedExec.execute_argv.mockResolvedValue(fail('Error: NetworkManager is not running.'));
    await expect(readGuestVpnStatus(cfg)).rejects.toThrow(/NetworkManager is not running/);
  });

  it('never runs anything but nmcli and curl', async () => {
    shown = details({ general: 'activated', vpn: '5 - VPN connected' });
    await readGuestVpnStatus(cfg);
    expect(new Set(calls.map(c => c.file))).toEqual(new Set(['nmcli', 'curl']));
  });
});
