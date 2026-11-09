import { promises as fs } from 'fs';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { NmGuestVpn } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm, fail } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'dev tun', 'remote vpn.example.com 1194', 'auth-user-pass',
  '<ca>', 'INLINE-CA', '</ca>'].join('\n');
const PASSWORD = 'Sup3r-s3cret-pa55';

describe('NmGuestVpn.importProfile', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  const importIt = (extra: Partial<{ ovpn: string; ca: string }> = {}) =>
    new NmGuestVpn(nm.cfg).importProfile({ ovpn: OVPN, username: 'guest@example.com', password: PASSWORD, ...extra });
  const modifyArgs = () => {
    const m = nm.find(a => a[1] === 'modify');
    expect(m).toHaveLength(1);
    return m[0].args;
  };
  const setting = (args: string[], key: string) => args[args.indexOf(key) + 1];

  it('import writes files 0600 in a fresh 0700 temp dir and removes it', async () => {
    await importIt();
    const staged = nm.staged!;
    expect(staged.fileMode).toBe(0o600);
    expect(staged.dirMode).toBe(0o700);
    // NM names the profile and its keyfile after the basename.
    expect(path.basename(staged.file)).toBe('nivuus-guest-vpn.ovpn');
    await expect(fs.stat(path.dirname(staged.file))).rejects.toThrow();
  });

  it('import inlines a separately uploaded CA, since NM keeps file references to the temp dir', async () => {
    const ovpn = ['client', 'remote vpn.example.com 1194', 'ca ca.crt', 'auth-user-pass'].join('\n');
    await importIt({ ovpn, ca: '-----BEGIN CERTIFICATE-----\r\nAAA\r\n-----END CERTIFICATE-----\r\n' });
    expect(nm.staged!.content).toContain('<ca>\n-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n</ca>');
    expect(nm.staged!.content).not.toMatch(/^ca ca\.crt$/m);
  });

  it('import rejects an invalid profile before touching NetworkManager', async () => {
    await expect(importIt({ ovpn: 'client\nscript-security 2\nremote x 1194' })).rejects.toThrow(/script-security/);
    expect(nm.calls).toHaveLength(0);
  });

  it('import calls nmcli connection import type openvpn', async () => {
    await importIt();
    expect(nm.find(a => a[1] === 'import')[0]).toEqual({
      file: 'nmcli', args: ['connection', 'import', 'type', 'openvpn', 'file', nm.staged!.file],
    });
  });

  it('import applies the bench settings', async () => {
    await importIt();
    const args = modifyArgs();
    expect(args.slice(0, 4)).toEqual(['connection', 'modify', 'id', 'nivuus-guest-vpn']);
    expect(setting(args, 'connection.zone')).toBe('external');
    expect(setting(args, 'connection.autoconnect')).toBe('no');
    expect(setting(args, 'ipv4.route-table')).toBe('200');
    expect(setting(args, 'ipv6.route-table')).toBe('200');
    expect(setting(args, 'ipv4.never-default')).toBe('no');
    expect(setting(args, 'ipv4.routing-rules')).toBe('priority 99 iif publicBridge table main suppress_prefixlength 0, '
      + 'priority 100 iif publicBridge table 200, priority 101 oif nvguest0 table 200');
    expect(setting(args, 'ipv6.routing-rules')).toBe('priority 100 iif publicBridge table 200');
    expect(setting(args, 'ipv6.routes')).toBe('::/0 table=200 type=unreachable');
    expect(setting(args, 'ipv6.ignore-auto-routes')).toBe('yes');
    const vpnData = args.flatMap((a, i) => (a === '+vpn.data' ? [args[i + 1]] : []));
    expect(vpnData).toEqual(['dev=nvguest0', 'dev-type=tun', 'ping-exit=60']);
    const text = await fs.readFile(nm.keyfile, 'utf8');
    expect(text).toContain('username=guest@example.com');
    expect(text).toContain(`[vpn-secrets]\npassword=${PASSWORD}`);
    expect(nm.find(a => a[1] === 'load')[0].args).toEqual(['connection', 'load', nm.keyfile]);
  });

  it('import never sets connection.autoconnect yes nor secondaries', async () => {
    await importIt();
    expect(setting(modifyArgs(), 'connection.autoconnect')).not.toBe('yes');
    expect(nm.calls.flatMap(c => c.args).some(a => a.includes('secondaries'))).toBe(false);
  });

  it('import replaces an existing profile and re-activates it only if desired state is on', async () => {
    nm.exists = true;
    nm.active = true;
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    await importIt();
    const order = nm.verbs();
    expect(order.indexOf('connection delete')).toBeLessThan(order.indexOf('connection import'));
    expect(order.lastIndexOf('connection up')).toBeGreaterThan(order.indexOf('connection load'));

    nm.calls = [];
    nm.exists = true;
    await writeDesiredEnabled(nm.cfg.stateFile, false);
    await importIt();
    expect(nm.find(a => a[1] === 'delete')).toHaveLength(1);
    expect(nm.find(a => a[1] === 'up')).toHaveLength(0);
  });

  it('import removes a half-configured profile and rethrows nmcli stderr', async () => {
    nm.override = a => (a[1] === 'modify' ? fail('Error: invalid property') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property/);
    expect(nm.find(a => a[1] === 'delete')[0].args).toEqual(['connection', 'delete', 'id', 'nivuus-guest-vpn']);
    expect(nm.find(a => a[1] === 'up')).toHaveLength(0);
  });

  it('import reports both errors when removing the half-configured profile fails too', async () => {
    nm.override = a => (a[1] === 'modify' ? fail('Error: invalid property')
      : a[1] === 'delete' ? fail('Error: NetworkManager is not running.') : undefined);
    await expect(importIt()).rejects.toThrow(/invalid property.*not running/);
  });

  it('no argv element ever contains the password', async () => {
    nm.exists = true;
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    await importIt();
    expect(nm.calls.length).toBeGreaterThan(0);
    for (const c of nm.calls) {
      expect([c.file, ...c.args].some(a => a.includes(PASSWORD))).toBe(false);
    }
  });
});
