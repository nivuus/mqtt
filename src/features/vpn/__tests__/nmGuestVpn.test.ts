import * as execModule from '../../../utils/exec';
import { NmGuestVpn, DEFAULT_GUEST_VPN_CONFIG } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm, fail } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'remote vpn.example.com 1194', 'auth-user-pass', '<ca>', 'X', '</ca>'].join('\n');
const ID = 'nivuus-guest-vpn';

describe('NmGuestVpn', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  const vpn = () => new NmGuestVpn(nm.cfg, nm.env);

  it('has the documented defaults', () => {
    expect(DEFAULT_GUEST_VPN_CONFIG).toEqual({
      bridge: 'publicBridge', connectionId: ID, device: 'nvguest0', table: 200,
      zone: 'external', stateFile: '/var/lib/mqtt-system-agent/guest-vpn.json',
    });
  });

  it('up addresses the live profile by UUID and passes ifname publicBridge', async () => {
    const { uuid } = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await vpn().up();
    expect(nm.find(a => a[1] === 'up')[0].args).toEqual(['connection', 'up', 'uuid', uuid, 'ifname', 'publicBridge']);
  });

  it('failed up keeps nmcli stderr in lastActivationError and throws', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    const v = vpn();
    nm.override = a => (a[1] === 'up' ? fail('Error: Connection activation failed: no secrets\n') : undefined);
    await expect(v.up()).rejects.toThrow(/no secrets/);
    expect(v.lastActivationError()).toBe('Error: Connection activation failed: no secrets');
    nm.override = undefined;
    await v.up();
    expect(v.lastActivationError()).toBeUndefined();
  });

  it('up fails when NM drops the VPN after nmcli returned 0 (wrong password)', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    nm.upOutcome = 'dropped';
    const v = vpn();
    await expect(v.up()).rejects.toThrow(/dropped the VPN while activating/);
    expect(v.lastActivationError()).toMatch(/dropped the VPN while activating/);
  });

  it('up still activating at the bound cancels the activation and fails', async () => {
    const { uuid } = await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    nm.upOutcome = 'stuck';
    const v = vpn();
    await expect(v.up()).rejects.toThrow(/still activating after 1 s/);
    expect(nm.find(a => a[1] === 'down')[0].args).toEqual(['connection', 'down', 'uuid', uuid]);
    expect(nm.active.has(uuid)).toBe(false);
    // 1000 ms bound at 100 ms polls: 11 reads, never an unbounded wait.
    expect(nm.find(a => a.includes('GENERAL.STATE'))).toHaveLength(11);
  });

  it('up without a profile fails and records why', async () => {
    const v = vpn();
    await expect(v.up()).rejects.toThrow(/no nivuus-guest-vpn profile/);
    expect(v.lastActivationError()).toMatch(/no nivuus-guest-vpn profile/);
  });

  it('down, isActive and profileExists read nmcli', async () => {
    const v = vpn();
    await expect(v.profileExists()).resolves.toBe(false);
    await expect(v.isActive()).resolves.toBe(false);
    const { uuid } = await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await expect(v.profileExists()).resolves.toBe(true);
    await expect(v.isActive()).resolves.toBe(true);
    await v.down();
    expect(nm.calls[nm.calls.length - 1].args).toEqual(['connection', 'down', 'uuid', uuid]);
    await expect(v.isActive()).resolves.toBe(false);
  });

  it('refuses to guess between duplicate profiles it did not stage', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await nm.addProfile(ID, 'nivuus-guest-vpn_b');
    const v = vpn();
    await expect(v.up()).rejects.toThrow(/2 profiles named nivuus-guest-vpn/);
    await expect(v.isActive()).rejects.toThrow(/2 profiles named/);
    expect(nm.find(a => a[1] === 'up')).toHaveLength(0);
    await expect(v.profileExists()).resolves.toBe(true);
  });

  it('a failing query throws instead of reporting false', async () => {
    nm.override = () => fail('Error: NetworkManager is not running.');
    await expect(vpn().isActive()).rejects.toThrow(/connection show failed: .*not running/);
    await expect(vpn().profileExists()).rejects.toThrow(/not running/);
  });

  it('never invokes firewall-cmd nor touches bridge-publicBridge', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    const v = vpn();
    await v.importProfile({ ovpn: OVPN, username: 'u', password: 'p' });
    await v.down();
    await v.up();
    expect(nm.calls.length).toBeGreaterThan(5);
    expect(nm.calls.every(c => c.file === 'nmcli')).toBe(true);
    for (const c of nm.calls) {
      expect(c.args.some(a => a.includes('bridge-publicBridge') || a.startsWith('ffffffff'))).toBe(false);
    }
  });
});
