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

  it('has the documented defaults', () => {
    expect(DEFAULT_GUEST_VPN_CONFIG).toEqual({
      bridge: 'publicBridge', connectionId: ID, device: 'nvguest0', table: 200,
      zone: 'external', stateFile: '/var/lib/mqtt-system-agent/guest-vpn.json',
    });
  });

  it('up passes ifname publicBridge', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    await new NmGuestVpn(nm.cfg, nm.env).up();
    expect(nm.calls[0].args).toEqual(['connection', 'up', 'id', ID, 'ifname', 'publicBridge']);
  });

  it('failed up keeps nmcli stderr in lastActivationError and throws', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a');
    const vpn = new NmGuestVpn(nm.cfg, nm.env);
    nm.override = a => (a[1] === 'up' ? fail('Error: Connection activation failed: no secrets\n') : undefined);
    await expect(vpn.up()).rejects.toThrow(/no secrets/);
    expect(vpn.lastActivationError()).toBe('Error: Connection activation failed: no secrets');
    nm.override = undefined;
    await vpn.up();
    expect(vpn.lastActivationError()).toBeUndefined();
  });

  it('down, isActive and profileExists read nmcli', async () => {
    const vpn = new NmGuestVpn(nm.cfg, nm.env);
    await expect(vpn.profileExists()).resolves.toBe(false);
    await expect(vpn.isActive()).resolves.toBe(false);
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await expect(vpn.profileExists()).resolves.toBe(true);
    await expect(vpn.isActive()).resolves.toBe(true);
    await vpn.down();
    expect(nm.calls[nm.calls.length - 1].args).toEqual(['connection', 'down', 'id', ID]);
  });

  it('a failing query throws instead of reporting false', async () => {
    nm.override = () => fail('Error: NetworkManager is not running.');
    await expect(new NmGuestVpn(nm.cfg, nm.env).isActive()).rejects.toThrow(/connection show failed: .*not running/);
    await expect(new NmGuestVpn(nm.cfg, nm.env).profileExists()).rejects.toThrow(/not running/);
  });

  it('never invokes firewall-cmd nor touches bridge-publicBridge', async () => {
    await nm.addProfile(ID, 'nivuus-guest-vpn_a', true);
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    const vpn = new NmGuestVpn(nm.cfg, nm.env);
    await vpn.importProfile({ ovpn: OVPN, username: 'u', password: 'p' });
    await vpn.down();
    await vpn.up();
    expect(nm.calls.length).toBeGreaterThan(5);
    expect(nm.calls.every(c => c.file === 'nmcli')).toBe(true);
    for (const c of nm.calls) expect(c.args.some(a => a.includes('bridge-publicBridge'))).toBe(false);
  });
});
