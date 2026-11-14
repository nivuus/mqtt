// src/websocket/wizard/__tests__/wifiHandlers.test.ts
//
// The wizard's Wi-Fi actions on an in-memory host: a new network is a new BSS, the
// radio's main network is never rewritten, and failures reach the caller.

import { createWifiHandlers } from '../wifiHandlers';
import { createFakeHost, FakeHost } from './fakeHost';
import { execute_argv } from '../../../utils/exec';

jest.mock('../../../utils/exec', () => ({ execute_argv: jest.fn(), execute_command: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), writeFileSync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedFs = require('fs') as { writeFileSync: jest.Mock };
const mockedExec = execute_argv as jest.MockedFunction<typeof execute_argv>;

const RADIO_24 = '/etc/hostapd/2.4Ghz.conf';
const RADIO_5 = '/etc/hostapd/5Ghz.conf';

const MAIN_SECTION = [
  'interface=wlan0',
  'driver=nl80211',
  'bridge=localBridge',
  'ctrl_interface=/var/run/hostapd',
  'channel=6',
  'ssid=Home',
  'auth_algs=1',
  'wpa=2',
  'wpa_key_mgmt=WPA-PSK',
  'rsn_pairwise=CCMP',
  'wpa_passphrase=main-secret-1',
].join('\n');

const GUEST_SECTION = [
  'bss=wlan1',
  'ssid=Guest',
  'bridge=publicBridge',
  'ap_isolate=1',
  'auth_algs=1',
  'wpa=2',
  'wpa_key_mgmt=WPA-PSK',
  'rsn_pairwise=CCMP',
  'wpa_passphrase=guest-secret-1',
].join('\n');

const FIXTURE_24 = `${MAIN_SECTION}\n\n${GUEST_SECTION}\n`;
const FIXTURE_5 = FIXTURE_24.replace('interface=wlan0', 'interface=wlan5').replace('bss=wlan1', 'bss=wlan6')
  .replace('channel=6', 'channel=36');

let host: FakeHost;
let wifi: ReturnType<typeof createWifiHandlers>;

beforeEach(() => {
  host = createFakeHost({ [RADIO_24]: FIXTURE_24, [RADIO_5]: FIXTURE_5 });
  mockedExec.mockImplementation((command, args) => host.exec(command, args) as never);
  mockedFs.writeFileSync.mockImplementation((path: string, content: string) => host.writeFileSync(path, content));
  wifi = createWifiHandlers();
});

const mainSectionOf = (content: string) => content.split('\n\nbss=')[0];
const hostapdCommands = () => host.calls
  .filter((c) => c.command === 'sudo' && c.args[0] === 'systemctl')
  .map((c) => c.args.slice(1).join(' '));

describe('wifi.add_network', () => {
  it('appends a BSS and leaves the main network byte-identical', async () => {
    const result = await wifi.add_network({
      ssid: 'Office', password: 'office-pass-1', security: 'WPA2-PSK', band: '2.4GHz',
    });

    expect(result).toEqual({ success: true, ssid: 'Office', band: '2.4GHz' });
    const written = host.files.get(RADIO_24)!;
    expect(mainSectionOf(written)).toBe(MAIN_SECTION);
    expect(written).toContain(GUEST_SECTION);
    expect(written).toMatch(/\nbss=wlan2\nssid=Office\n/);
    expect(written).toContain('wpa_passphrase=office-pass-1');
    expect(host.files.get(RADIO_5)).toBe(FIXTURE_5);
    // A new BSS is a new virtual interface: only a restart creates it.
    expect(hostapdCommands()).toEqual(['restart hostapd']);
  });

  it('refuses an unknown security value instead of writing an open network', async () => {
    await expect(wifi.add_network({ ssid: 'Office', password: 'office-pass-1', security: 'WEP' }))
      .rejects.toThrow(/Unknown security type/);
    expect(host.files.get(RADIO_24)).toBe(FIXTURE_24);
    expect(hostapdCommands()).toEqual([]);
  });

  it('refuses an unknown band instead of falling back to 2.4 GHz', async () => {
    await expect(wifi.add_network({ ssid: 'Office', password: 'office-pass-1', band: '6GHz' }))
      .rejects.toThrow(/band/);
    expect(host.files.get(RADIO_24)).toBe(FIXTURE_24);
  });

  it('refuses an SSID that already exists on the radio', async () => {
    await expect(wifi.add_network({ ssid: 'Home', password: 'office-pass-1' })).rejects.toThrow(/already exists/);
    expect(host.files.get(RADIO_24)).toBe(FIXTURE_24);
  });

  it('reports a failed hostapd restart to the caller', async () => {
    host.exitCodes.set('sudo systemctl restart hostapd', 1);
    await expect(wifi.add_network({ ssid: 'Office', password: 'office-pass-1' })).rejects.toThrow(/restart hostapd failed/);
  });

  it('reports a failed write to the caller and does not touch hostapd', async () => {
    host.exitCodes.set(`sudo cp ${RADIO_24} ${RADIO_24}.backup`, 1);
    await expect(wifi.add_network({ ssid: 'Office', password: 'office-pass-1' })).rejects.toThrow(/failed/);
    expect(host.files.get(RADIO_24)).toBe(FIXTURE_24);
    expect(hostapdCommands()).toEqual([]);
  });

  it.each([
    ['WPA2-PSK', "a$$b$&c$'d$1"],
    ['WPA3-SAE', 'пароль-сети-日本語'],
  ])('writes a %s password byte for byte (%s)', async (security, password) => {
    await wifi.add_network({ ssid: 'Office', password, security });
    const passwordKey = security === 'WPA3-SAE' ? 'sae_password' : 'wpa_passphrase';
    expect(host.files.get(RADIO_24)).toContain(`\n${passwordKey}=${password}\n`);
    expect(mainSectionOf(host.files.get(RADIO_24)!)).toBe(MAIN_SECTION);
  });
});

describe('wifi.delete_network', () => {
  it('cannot remove or blank the radio main network', async () => {
    await expect(wifi.delete_network({ configPath: RADIO_24 })).rejects.toThrow(/ssid/);
    await expect(wifi.delete_network({ configPath: RADIO_24, ssid: 'Home' })).rejects.toThrow(/main network/);
    expect(host.files.get(RADIO_24)).toBe(FIXTURE_24);
    expect(hostapdCommands()).toEqual([]);
  });

  it('removes the whole section of an extra BSS', async () => {
    await expect(wifi.delete_network({ configPath: RADIO_24, ssid: 'Guest' })).resolves.toEqual({ success: true });
    // Only the trailing blank line that separated the two sections may remain.
    expect(host.files.get(RADIO_24)!.trimEnd()).toBe(MAIN_SECTION);
    expect(hostapdCommands()).toEqual(['restart hostapd']);
  });
});

describe('wifi.get_networks', () => {
  it('never returns a passphrase', async () => {
    const networks = await wifi.get_networks({}) as Array<Record<string, unknown>>;
    expect(networks.map((n) => [n.ssid, n.band, n.security])).toEqual([
      ['Home', '2.4GHz', 'WPA2-PSK'], ['Guest', '2.4GHz', 'WPA2-PSK'],
      ['Home', '5GHz', 'WPA2-PSK'], ['Guest', '5GHz', 'WPA2-PSK'],
    ]);
    const serialized = JSON.stringify(networks);
    expect(serialized).not.toContain('secret');
    expect(networks.every((n) => !('password' in n))).toBe(true);
  });
});

describe('wifi.reload', () => {
  it('reports a failed reload to the caller', async () => {
    host.exitCodes.set('sudo systemctl reload hostapd', 1);
    await expect(wifi.reload({})).rejects.toThrow(/reload hostapd failed/);
  });
});
