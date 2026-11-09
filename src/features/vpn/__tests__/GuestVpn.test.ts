import * as execModule from '../../../utils/exec';
import { writeDesiredEnabled } from '../desiredState';
import { GuestVpnDnsError, reconcileDnsRedirect } from '../guestVpnDns';
import { readGuestVpnStatus } from '../guestVpnStatus';
import { fakeStatus, Harness, makeHarness, TOPIC } from './guestVpnHarness';

jest.mock('../../../utils/exec');
jest.mock('../guestVpnStatus');
jest.mock('../guestVpnDns', () => ({ ...jest.requireActual('../guestVpnDns'), reconcileDnsRedirect: jest.fn() }));
jest.mock('../../../config', () => ({
  getConfigManager: () => ({ config: require('./guestVpnHarness').mockAgentConfig }),
}));

const mockedExec = execModule as jest.Mocked<typeof execModule>;
const mockedStatus = readGuestVpnStatus as jest.MockedFunction<typeof readGuestVpnStatus>;
const mockedReconcile = reconcileDnsRedirect as jest.MockedFunction<typeof reconcileDnsRedirect>;

describe('GuestVpn feature', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness(mockedExec);
    mockedStatus.mockImplementation((_cfg, lastError) => fakeStatus(h.nm, lastError));
    mockedReconcile.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await h.feature.stop();
    await h.nm.remove();
  });

  it('publishes four discovery payloads with unique_ids under guest_vpn', async () => {
    await h.start();
    const discovery = h.mqtt.publishedMessages.filter(m => m.topic.startsWith('homeassistant/'));
    const byTopic = Object.fromEntries(discovery.map(m => [m.topic, JSON.parse(String(m.message))]));
    expect(Object.keys(byTopic).sort()).toEqual([
      'homeassistant/binary_sensor/nivuus/nivuus_guest_vpn_on_orange/config',
      'homeassistant/sensor/nivuus/nivuus_guest_vpn_exit_ip/config',
      'homeassistant/sensor/nivuus/nivuus_guest_vpn_state/config',
      'homeassistant/switch/nivuus/nivuus_guest_vpn_switch/config',
    ]);
    const sw = byTopic['homeassistant/switch/nivuus/nivuus_guest_vpn_switch/config'];
    expect(sw).toMatchObject({
      name: 'Network Guest VPN Switch', unique_id: 'nivuus_guest_vpn_switch',
      command_topic: TOPIC('switch/set'), payload_on: 'ON', payload_off: 'OFF',
    });
    expect(byTopic['homeassistant/sensor/nivuus/nivuus_guest_vpn_state/config']).toMatchObject({
      name: 'Network Guest VPN State Sensor', json_attributes_topic: TOPIC('state/attributes'),
      options: ['connected', 'connecting', 'disabled', 'no_config', 'error'],
    });
    expect(byTopic['homeassistant/sensor/nivuus/nivuus_guest_vpn_exit_ip/config'].name)
      .toBe('Network Guest VPN Exit IP Sensor');
    expect(byTopic['homeassistant/binary_sensor/nivuus/nivuus_guest_vpn_on_orange/config'].name)
      .toBe('Network Guest VPN On Orange Sensor');
    expect(h.mqtt.subscribedTopics).toEqual([TOPIC('switch/set')]);
    expect(mockedExec.execute_argv.mock.calls.map(c => c[0])).not.toContain('firewall-cmd');
    expect(mockedExec.execute_command).not.toHaveBeenCalled();
  });

  it('switch ON writes desired state on, calls up() and republishes state', async () => {
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    await h.start();
    expect(h.last('state/state')).toBe('disabled');
    await h.send('ON');
    expect(JSON.parse((await h.desiredFile())!)).toEqual({ enabled: true });
    expect(h.upCalls()).toBe(1);
    expect(h.last('switch/state')).toBe('ON');
    expect(h.payloads('state/state').slice(-2)).toEqual(['connecting', 'connected']);
    expect(h.last('exit_ip/state')).toBe('203.0.113.7');
    expect(h.last('on_orange/state')).toBe('OFF');
  });

  it('switch OFF writes desired state off, calls down() and empties the DNS table', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn', true);
    await h.start();
    mockedReconcile.mockClear();
    await h.send('OFF');
    expect(JSON.parse((await h.desiredFile())!)).toEqual({ enabled: false });
    expect(h.nm.find(a => a.includes('down'))).toHaveLength(1);
    expect(h.last('switch/state')).toBe('OFF');
    expect(h.last('state/state')).toBe('disabled');
    expect(h.last('on_orange/state')).toBe('ON');
    expect(mockedReconcile).toHaveBeenCalledTimes(1);
    expect(mockedReconcile.mock.calls[0][1].state).toBe('disabled');
  });

  it('ignores switch payloads other than ON and OFF', async () => {
    await h.start();
    await h.send('TOGGLE');
    expect(await h.desiredFile()).toBeUndefined();
    expect(h.nm.calls.filter(c => c.args.includes('up') || c.args.includes('down'))).toHaveLength(0);
  });

  it('update publishes state, exit ip, on_orange and reconciles DNS', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn', true);
    await h.start();
    expect(h.last('state/state')).toBe('connected');
    expect(h.last('exit_ip/state')).toBe('203.0.113.7');
    expect(h.last('on_orange/state')).toBe('OFF');
    expect(h.last('switch/state')).toBe('ON');
    expect(h.attributes()).toMatchObject({ remote: 'vpn.example.com', last_error: null, dns_error: null });
    expect(mockedReconcile).toHaveBeenCalledWith(h.nm.cfg, expect.objectContaining({ state: 'connected' }));
    expect(h.upCalls()).toBe(0);
  });

  it('publishes no exit IP and on_orange ON while not connected', async () => {
    await h.start();
    expect(h.last('state/state')).toBe('no_config');
    expect(h.last('exit_ip/state')).toBe('None');
    expect(h.last('on_orange/state')).toBe('ON');
  });

  it('surfaces a DNS reconcile failure as dns_error without changing on_orange', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn', true);
    mockedReconcile.mockRejectedValue(new GuestVpnDnsError('the tunnel pushed no IPv4 DNS (none)'));
    await h.start();
    expect(h.last('state/state')).toBe('connected');
    expect(h.last('on_orange/state')).toBe('OFF');
    expect(h.attributes().dns_error).toBe('the tunnel pushed no IPv4 DNS (none)');
  });

  it('surfaces duplicate profiles as error and never guesses which one to activate', async () => {
    await writeDesiredEnabled(h.nm.cfg.stateFile, true);
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn');
    await h.nm.addProfile('nivuus-guest-vpn', 'nivuus-guest-vpn-1');
    await h.start();
    expect(h.upCalls()).toBe(0);
    expect(h.last('state/state')).toBe('error');
    expect(h.attributes().last_error).toContain('2 profiles named nivuus-guest-vpn');
    expect(h.attributes().action_error).toContain('refusing to guess');
  });

  it('reports a status read failure as error instead of a stale state', async () => {
    mockedStatus.mockRejectedValue(new Error('nmcli connection show failed: boom'));
    await h.start();
    expect(h.last('state/state')).toBe('error');
    expect(h.attributes().last_error).toContain('boom');
    expect(h.last('on_orange/state')).toBe('ON');
  });
});
