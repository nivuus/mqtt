// src/features/wifi/hostapdConfigText.ts
//
// Pure transformations of one hostapd configuration file (text in, text out).
// A file holds one radio: the radio settings and its first BSS come before the
// first `bss=` line, then one section per extra BSS.

import {
  SecurityType, SECURITY_KEYS, SECURITY_TYPE_MAPPING, securityTypeFromKeyMgmt,
} from './securityProfiles';

export interface NetworkConfig {
  ssid: string;
  password: string;
  securityType: SecurityType;
  configFiles: string[]; // files where this SSID appears (2.4 GHz and/or 5 GHz)
  isPrimary: boolean; // the radio's first BSS, which cannot be deleted
  bssInterfaces?: string[];
  bridge?: string;
}

export interface NewBss {
  ssid: string;
  password: string;
  securityType: SecurityType;
  bridge: string;
}

/**
 * Per-network settings a new BSS copies from an existing BSS on the same bridge, so
 * that a guest network added from Home Assistant behaves like the existing guest one.
 * ctrl_interface is not inherited by a bss= section: without it nothing can reach the BSS.
 */
const POLICY_KEYS = [
  'ctrl_interface', 'ap_isolate', 'access_network_type', 'rrm_neighbor_report',
  'rrm_beacon_report', 'multicast_to_unicast', 'bss_transition',
];

interface Section {
  start: number; // index of the bss= line, or 0 for the first section
  end: number; // exclusive
  primary: boolean;
}

const keyOf = (line: string): string | undefined => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const eq = trimmed.indexOf('=');
  return eq > 0 ? trimmed.substring(0, eq) : undefined;
};

const valueOf = (line: string): string => line.trim().substring(line.trim().indexOf('=') + 1).trim();

function sections(lines: string[]): Section[] {
  const starts = [0];
  lines.forEach((line, i) => { if (keyOf(line) === 'bss') starts.push(i); });
  return starts.map((start, n) => ({
    start,
    end: n + 1 < starts.length ? starts[n + 1] : lines.length,
    primary: n === 0,
  }));
}

function sectionValue(lines: string[], section: Section, key: string): string | undefined {
  for (let i = section.start; i < section.end; i++) {
    if (keyOf(lines[i]) === key) return valueOf(lines[i]);
  }
  return undefined;
}

function sectionOfSsid(lines: string[], ssid: string): Section | undefined {
  return sections(lines).find((s) => sectionValue(lines, s, 'ssid') === ssid);
}

export function parseNetworkConfig(content: string, filePath: string): Map<string, NetworkConfig> {
  const networks = new Map<string, NetworkConfig>();
  if (!content) return networks;
  const lines = content.split('\n');
  for (const section of sections(lines)) {
    const ssid = sectionValue(lines, section, 'ssid');
    if (!ssid) continue;
    const bss = section.primary ? undefined : sectionValue(lines, section, 'bss');
    const keyMgmt = sectionValue(lines, section, 'wpa_key_mgmt');
    const wpa = sectionValue(lines, section, 'wpa');
    const securityType: SecurityType = !wpa || wpa === '0' ? 'Open' : securityTypeFromKeyMgmt(keyMgmt ?? 'WPA-PSK');
    const password = sectionValue(lines, section, 'wpa_passphrase') ?? sectionValue(lines, section, 'sae_password') ?? '';
    const bridge = sectionValue(lines, section, 'bridge');
    const existing = networks.get(ssid);
    if (existing) {
      if (bss) existing.bssInterfaces = [...(existing.bssInterfaces ?? []), bss];
      if (bridge) existing.bridge = bridge;
      continue;
    }
    networks.set(ssid, {
      ssid, password, securityType, configFiles: [filePath], isPrimary: section.primary,
      bssInterfaces: bss ? [bss] : undefined, bridge,
    });
  }
  return networks;
}

/** Bridges the BSSes of this file are attached to, in file order. */
export function listBridges(content: string): string[] {
  const lines = content.split('\n');
  const bridges = sections(lines).map((s) => sectionValue(lines, s, 'bridge')).filter((b): b is string => !!b);
  return [...new Set(bridges)];
}

/** Append a BSS for `network`; returns the new text and the interface hostapd will create. */
export function addBss(content: string, network: NewBss): { content: string; ifname: string } {
  const lines = content.replace(/\n+$/, '').split('\n');
  const all = sections(lines);
  const radioIf = sectionValue(lines, all[0], 'interface');
  if (!radioIf) throw new Error('No interface= line: not a hostapd radio configuration');
  const base = radioIf.replace(/\d+$/, '');
  const used = all
    .map((s) => (s.primary ? radioIf : sectionValue(lines, s, 'bss')) ?? '')
    .filter((name) => name.startsWith(base))
    .map((name) => parseInt(name.substring(base.length), 10))
    .filter((n) => !Number.isNaN(n));
  const ifname = `${base}${Math.max(...used) + 1}`;

  const template = all.find((s) => sectionValue(lines, s, 'bridge') === network.bridge);
  const policy = POLICY_KEYS
    .map((key) => [key, (template && sectionValue(lines, template, key))
      ?? (key === 'ctrl_interface' ? sectionValue(lines, all[0], key) : undefined)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);

  const security = SECURITY_TYPE_MAPPING[network.securityType](network.password);
  const section = [
    '',
    `bss=${ifname}`,
    `ssid=${network.ssid}`,
    `bridge=${network.bridge}`,
    ...policy.map(([key, value]) => `${key}=${value}`),
    ...Object.entries(security).map(([key, value]) => `${key}=${value}`),
  ];
  return { content: [...lines, ...section].join('\n') + '\n', ifname };
}

/** Rename and/or re-secure the BSS whose ssid is `oldSsid`. */
export function updateNetwork(
  content: string, oldSsid: string, newSsid: string, password: string, securityType: SecurityType,
): string {
  const lines = content.split('\n');
  const target = sectionOfSsid(lines, oldSsid);
  if (!target) throw new Error(`Network ${oldSsid} not found`);
  const security = Object.entries(SECURITY_TYPE_MAPPING[securityType](password)).map(([k, v]) => `${k}=${v}`);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const inTarget = i >= target.start && i < target.end;
    const key = keyOf(line);
    if (inTarget && key && (SECURITY_KEYS as readonly string[]).includes(key)) return;
    if (inTarget && key === 'ssid') {
      out.push(`ssid=${newSsid}`, ...security);
      return;
    }
    out.push(line);
  });
  return out.join('\n');
}

/** Remove the whole BSS section of `ssid`. The radio's first BSS cannot be removed. */
export function removeNetwork(content: string, ssid: string): string {
  const lines = content.split('\n');
  const target = sectionOfSsid(lines, ssid);
  if (!target) throw new Error(`Network ${ssid} not found`);
  if (target.primary) {
    throw new Error(`${ssid} is the radio's main network and cannot be deleted (rename it instead)`);
  }
  const kept = [...lines.slice(0, target.start), ...lines.slice(target.end)];
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}
