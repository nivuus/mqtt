import * as execModule from '../../../utils/exec';
import { NmGuestVpn, DEFAULT_GUEST_VPN_CONFIG } from '../nmGuestVpn';
import { writeDesiredEnabled } from '../desiredState';
import { FakeNm, fail } from './fakeNmcli';

jest.mock('../../../utils/exec');
const mockedExec = execModule as jest.Mocked<typeof execModule>;

const OVPN = ['client', 'remote vpn.example.com 1194', 'auth-user-pass', '<ca>', 'X', '</ca>'].join('\n');

describe('NmGuestVpn', () => {
  let nm: FakeNm;
  beforeEach(async () => { nm = new FakeNm(); await nm.install(mockedExec); });
  afterEach(async () => { await nm.remove(); });

  it('has the documented defaults', () => {
    expect(DEFAULT_GUEST_VPN_CONFIG).toEqual({
      bridge: 'publicBridge', connectionId: 'nivuus-guest-vpn', device: 'nvguest0', table: 200,
      zone: 'external', stateFile: '/var/lib/mqtt-system-agent/guest-vpn.json',
    });
  });

  it('up passes ifname publicBridge', async () => {
    await new NmGuestVpn(nm.cfg).up();
    expect(nm.calls[0].args).toEqual(['connection', 'up', 'id', 'nivuus-guest-vpn', 'ifname', 'publicBridge']);
  });

  it('failed up keeps nmcli stderr in lastActivationError and throws', async () => {
    const vpn = new NmGuestVpn(nm.cfg);
    nm.override = a => (a[1] === 'up' ? fail('Error: Connection activation failed: no secrets\n') : undefined);
    await expect(vpn.up()).rejects.toThrow(/no secrets/);
    expect(vpn.lastActivationError()).toBe('Error: Connection activation failed: no secrets');
    nm.override = undefined;
    await vpn.up();
    expect(vpn.lastActivationError()).toBeUndefined();
  });

  it('down, isActive and profileExists read nmcli', async () => {
    const vpn = new NmGuestVpn(nm.cfg);
    await expect(vpn.profileExists()).resolves.toBe(false);
    await expect(vpn.isActive()).resolves.toBe(false);
    nm.exists = true;
    nm.active = true;
    await expect(vpn.profileExists()).resolves.toBe(true);
    await expect(vpn.isActive()).resolves.toBe(true);
    await vpn.down();
    expect(nm.calls[nm.calls.length - 1].args).toEqual(['connection', 'down', 'id', 'nivuus-guest-vpn']);
  });

  it('a failing query throws instead of reporting false', async () => {
    nm.override = () => fail('Error: NetworkManager is not running.');
    await expect(new NmGuestVpn(nm.cfg).isActive()).rejects.toThrow(/connection show failed: .*not running/);
    await expect(new NmGuestVpn(nm.cfg).profileExists()).rejects.toThrow(/not running/);
  });

  it('never invokes firewall-cmd nor touches bridge-publicBridge', async () => {
    nm.exists = true;
    await writeDesiredEnabled(nm.cfg.stateFile, true);
    const vpn = new NmGuestVpn(nm.cfg);
    await vpn.importProfile({ ovpn: OVPN, username: 'u', password: 'p' });
    await vpn.down();
    await vpn.up();
    expect(nm.calls.length).toBeGreaterThan(5);
    expect(nm.calls.every(c => c.file === 'nmcli')).toBe(true);
    for (const c of nm.calls) expect(c.args.some(a => a.includes('bridge-publicBridge'))).toBe(false);
  });
});
