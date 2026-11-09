import { promises as fs } from 'fs';
import * as path from 'path';
import * as execModule from '../../../utils/exec';
import { NmGuestVpn } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'dev tun', 'remote vpn.example.com 1194', 'auth-user-pass',
  '<ca>', 'INLINE-CA', '</ca>'].join('\n');
const PASSWORD = 'Sup3r-s3cret-pa55';
const PEM = '-----BEGIN CERTIFICATE-----\r\nMIIB+zCCAWSg/AwIBAgI=\r\nAAAA\r\n-----END CERTIFICATE-----\r\n';
const CA_REF = ['client', 'remote vpn.example.com 1194', 'ca ca.crt', 'auth-user-pass'].join('\n');

describe('NmGuestVpn.importProfile: profile and settings', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  const importIt = (extra: Partial<{ ovpn: string; ca: string }> = {}) =>
    new NmGuestVpn(nm.cfg, nm.env)
      .importProfile({ ovpn: OVPN, username: 'guest@example.com', password: PASSWORD, ...extra });
  const settingsArgs = () => {
    const m = nm.find(a => a[1] === 'modify' && a.includes('ipv4.route-table'));
    expect(m).toHaveLength(1);
    return m[0].args;
  };
  const setting = (args: string[], key: string) => args[args.indexOf(key) + 1];

  it('import writes files 0600 in a fresh 0700 temp dir and removes it', async () => {
    await importIt();
    const staged = nm.staged[0];
    expect(staged.fileMode).toBe(0o600);
    expect(staged.dirMode).toBe(0o700);
    // NM names the imported profile and its keyfile after the basename: a staging name.
    expect(path.basename(staged.file)).toBe('nivuus-guest-vpn_a.ovpn');
    await expect(fs.stat(path.dirname(staged.file))).rejects.toThrow();
  });

  it('import inlines a separately uploaded CA, since NM keeps file references to the temp dir', async () => {
    await importIt({ ovpn: CA_REF, ca: PEM });
    expect(nm.staged[0].content)
      .toContain('<ca>\n-----BEGIN CERTIFICATE-----\nMIIB+zCCAWSg/AwIBAgI=\nAAAA\n-----END CERTIFICATE-----\n</ca>');
    expect(nm.staged[0].content).not.toMatch(/^ca ca\.crt$/m);
  });

  it.each([
    ['a block that closes <ca> and adds directives', `${PEM}</ca>\nscript-security 2\nup /x\n<ca>\n${PEM}`],
    ['a directive line', `${PEM}script-security 2\n`],
    ['a private key', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'],
    ['an unterminated certificate', '-----BEGIN CERTIFICATE-----\nAAAA\n'],
    ['an empty certificate', '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n'],
    ['nothing', ''],
  ])('import rejects a CA that is %s, before any nmcli call', async (_label, ca) => {
    await expect(importIt({ ovpn: CA_REF, ca })).rejects.toThrow(/CA|ca/);
    expect(nm.calls).toHaveLength(0);
  });

  it('import accepts a CA bundle of several certificates', async () => {
    await importIt({ ovpn: CA_REF, ca: `${PEM}\n${PEM}` });
    expect(nm.staged[0].content.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
  });

  it('import rejects an invalid profile before touching NetworkManager', async () => {
    await expect(importIt({ ovpn: 'client\nscript-security 2\nremote x 1194' })).rejects.toThrow(/script-security/);
    expect(nm.calls).toHaveLength(0);
  });

  it('import calls nmcli connection import type openvpn', async () => {
    await importIt();
    expect(nm.find(a => a[1] === 'import')[0]).toEqual({
      file: 'nmcli', args: ['connection', 'import', 'type', 'openvpn', 'file', nm.staged[0].file],
    });
  });

  it('import applies the bench settings to the staging profile', async () => {
    await importIt();
    const args = settingsArgs();
    // Addressed by the UUID of the staged import, now the live profile.
    expect(args.slice(0, 4)).toEqual(['connection', 'modify', 'uuid', nm.uuidsOf('nivuus-guest-vpn')[0]]);
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
    const keyfile = nm.profiles.get(nm.uuidsOf('nivuus-guest-vpn')[0])!.keyfile;
    const text = await fs.readFile(keyfile, 'utf8');
    expect(text).toContain('username=guest@example.com');
    expect(text).toContain(`[vpn-secrets]\npassword=${PASSWORD}`);
    expect(nm.find(a => a[1] === 'load')[0].args).toEqual(['connection', 'load', keyfile]);
  });

  it('import never sets connection.autoconnect yes nor secondaries', async () => {
    await importIt();
    expect(setting(settingsArgs(), 'connection.autoconnect')).not.toBe('yes');
    expect(nm.calls.flatMap(c => c.args).some(a => a.includes('secondaries'))).toBe(false);
  });

  it('no argv element ever contains the password', async () => {
    await nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    await importIt();
    expect(nm.calls.length).toBeGreaterThan(5);
    for (const c of nm.calls) {
      expect([c.file, ...c.args].some(a => a.includes(PASSWORD))).toBe(false);
    }
  });
});
