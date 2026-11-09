// src/features/wifi/__tests__/hostapdConfigText.test.ts

import { addBss, listBridges, parseNetworkConfig, removeNetwork, updateNetwork } from '../hostapdConfigText';

// Shape of /etc/hostapd/2.4Ghz.conf on the server (2026-11-09), secrets replaced.
const RADIO = [
  'ctrl_interface=/var/run/hostapd',
  'interface=wlp11s0',
  'driver=nl80211',
  'hw_mode=g',
  'channel=6',
  'ssid=home',
  'bssid=8e:49:e2:71:27:b9',
  'bridge=localBridge',
  'auth_algs=1',
  'wpa=2',
  'wpa_key_mgmt=WPA-PSK SAE',
  'rsn_pairwise=CCMP',
  'wpa_passphrase=home-secret',
  'access_network_type=0',
  'ieee80211w=1',
  'sae_require_mfp=1',
  'sae_pwe=2',
  'rrm_neighbor_report=1',
  'bss=wlp11s1',
  'bssid=8e:49:e2:71:27:ba',
  'ssid=guests',
  'bridge=publicBridge',
  'ap_isolate=1',
  'auth_algs=1',
  'wpa=2',
  'wpa_key_mgmt=WPA-PSK',
  'rsn_pairwise=CCMP',
  'wpa_passphrase=guest-secret',
  'access_network_type=1',
  'ctrl_interface=/var/run/hostapd',
  'rrm_neighbor_report=1',
  '',
].join('\n');

const lines = (text: string) => text.split('\n');

describe('parseNetworkConfig', () => {
  it('reads each BSS with its bridge, security and password', () => {
    const networks = parseNetworkConfig(RADIO, '/etc/hostapd/2.4Ghz.conf');
    expect(networks.get('home')).toMatchObject({
      isPrimary: true, bridge: 'localBridge', securityType: 'WPA2/WPA3-Mixed', password: 'home-secret',
    });
    expect(networks.get('guests')).toMatchObject({
      isPrimary: false, bridge: 'publicBridge', securityType: 'WPA2-PSK', bssInterfaces: ['wlp11s1'],
    });
  });

  it('treats PSK-SHA256 next to SAE as mixed mode', () => {
    const text = RADIO.replace('wpa_key_mgmt=WPA-PSK SAE', 'wpa_key_mgmt=WPA-PSK WPA-PSK-SHA256 SAE');
    expect(parseNetworkConfig(text, 'f').get('home')!.securityType).toBe('WPA2/WPA3-Mixed');
  });

  it('lists the bridges in file order', () => {
    expect(listBridges(RADIO)).toEqual(['localBridge', 'publicBridge']);
  });
});

describe('addBss', () => {
  it('names the interface after the radio and attaches the chosen bridge', () => {
    const { content, ifname } = addBss(RADIO, { ssid: 'party', password: 'party-secret', securityType: 'WPA2-PSK', bridge: 'publicBridge' });
    expect(ifname).toBe('wlp11s2');
    const added = lines(content).slice(lines(content).indexOf('bss=wlp11s2'));
    expect(added).toEqual(expect.arrayContaining(['ssid=party', 'bridge=publicBridge', 'wpa_passphrase=party-secret']));
    expect(added).not.toContain('bridge=localBridge');
  });

  it('copies the isolation and control socket of the existing BSS on that bridge', () => {
    const { content } = addBss(RADIO, { ssid: 'party', password: 'party-secret', securityType: 'WPA2-PSK', bridge: 'publicBridge' });
    const added = lines(content).slice(lines(content).indexOf('bss=wlp11s2'));
    expect(added).toEqual(expect.arrayContaining([
      'ap_isolate=1', 'access_network_type=1', 'ctrl_interface=/var/run/hostapd', 'rrm_neighbor_report=1',
    ]));
  });

  it('falls back to the radio control socket when no BSS shares the bridge', () => {
    const { content } = addBss(RADIO, { ssid: 'lab', password: 'lab-secret-1', securityType: 'WPA3-SAE', bridge: 'labBridge' });
    const added = lines(content).slice(lines(content).indexOf('bss=wlp11s2'));
    expect(added).toContain('ctrl_interface=/var/run/hostapd');
    expect(added).not.toContain('ap_isolate=1');
  });

  it('refuses a file without an interface line', () => {
    expect(() => addBss('ssid=x\n', { ssid: 'a', password: 'aaaaaaaa', securityType: 'Open', bridge: 'b' })).toThrow(/interface=/);
  });
});

describe('updateNetwork', () => {
  it('writes the new security right after the ssid and drops every old security line', () => {
    const out = lines(updateNetwork(RADIO, 'guests', 'guests', 'new-guest-secret', 'WPA2/WPA3-Mixed'));
    const at = out.indexOf('ssid=guests');
    expect(out.slice(at + 1, at + 10)).toEqual([
      'auth_algs=1', 'wpa=2', 'wpa_key_mgmt=WPA-PSK SAE', 'rsn_pairwise=CCMP',
      'wpa_passphrase=new-guest-secret', 'sae_password=new-guest-secret', 'ieee80211w=1',
      'sae_require_mfp=1', 'sae_pwe=2',
    ]);
    expect(out.filter((l) => l === 'wpa_passphrase=guest-secret')).toHaveLength(0);
    expect(out.filter((l) => l.startsWith('wpa_key_mgmt='))).toHaveLength(2);
  });

  it('leaves the other BSS untouched', () => {
    const out = updateNetwork(RADIO, 'guests', 'visitors', 'new-guest-secret', 'WPA2-PSK');
    const home = lines(out).slice(0, lines(out).indexOf('bss=wlp11s1'));
    expect(home).toEqual(lines(RADIO).slice(0, lines(RADIO).indexOf('bss=wlp11s1')));
    expect(out).toContain('ssid=visitors');
  });

  it('does not drop SAE lines when switching a mixed BSS to WPA2 then back', () => {
    const wpa2 = updateNetwork(RADIO, 'home', 'home', 'home-secret', 'WPA2-PSK');
    expect(lines(wpa2).slice(0, 18)).not.toContain('sae_require_mfp=1');
    const mixed = updateNetwork(wpa2, 'home', 'home', 'home-secret', 'WPA2/WPA3-Mixed');
    expect(lines(mixed)).toContain('sae_require_mfp=1');
  });

  it('throws for an unknown network', () => {
    expect(() => updateNetwork(RADIO, 'nope', 'nope', 'aaaaaaaa', 'WPA2-PSK')).toThrow(/not found/);
  });
});

describe('removeNetwork', () => {
  it('removes the whole BSS section, bss= and bssid= included', () => {
    const out = removeNetwork(RADIO, 'guests');
    expect(out).not.toMatch(/bss=wlp11s1|8e:49:e2:71:27:ba|guest-secret|publicBridge/);
    expect(parseNetworkConfig(out, 'f').size).toBe(1);
  });

  it('refuses to remove the radio main network', () => {
    expect(() => removeNetwork(RADIO, 'home')).toThrow(/main network/);
  });
});
