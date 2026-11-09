// src/features/wifi/securityProfiles.ts
//
// The security types offered in Home Assistant and the hostapd lines each one writes.

import { Validators } from '../../utils/validators';

export const SECURITY_TYPES = ['WPA2-PSK', 'WPA3-SAE', 'WPA2/WPA3-Mixed', 'Open'] as const;
export type SecurityType = typeof SECURITY_TYPES[number];

export function isSecurityType(value: string): value is SecurityType {
  return (SECURITY_TYPES as readonly string[]).includes(value);
}

/** Every key a profile may write: removed from a BSS before its new profile is written. */
export const SECURITY_KEYS = [
  'auth_algs', 'wpa', 'wpa_key_mgmt', 'rsn_pairwise', 'wpa_passphrase', 'sae_password',
  'ieee80211w', 'sae_require_mfp', 'sae_pwe', 'wpa_psk_file',
] as const;

export const SECURITY_TYPE_MAPPING: Record<SecurityType, (password: string) => Record<string, string>> = {
  'WPA2-PSK': (password) => ({
    auth_algs: '1',
    wpa: '2',
    wpa_key_mgmt: 'WPA-PSK',
    rsn_pairwise: 'CCMP',
    wpa_passphrase: password,
  }),
  'WPA3-SAE': (password) => ({
    auth_algs: '1',
    wpa: '2',
    wpa_key_mgmt: 'SAE',
    rsn_pairwise: 'CCMP',
    sae_password: password,
    ieee80211w: '2', // PMF is mandatory with WPA3
    sae_pwe: '2', // hunting-and-pecking and hash-to-element
  }),
  'WPA2/WPA3-Mixed': (password) => ({
    auth_algs: '1',
    wpa: '2',
    wpa_key_mgmt: 'WPA-PSK SAE',
    rsn_pairwise: 'CCMP',
    wpa_passphrase: password,
    sae_password: password,
    ieee80211w: '1', // optional for WPA2 clients
    sae_require_mfp: '1', // but required for those that use SAE
    sae_pwe: '2',
  }),
  'Open': () => ({
    auth_algs: '1',
  }),
};

/** Map a wpa_key_mgmt value (and wpa=) read from a file back to the type shown in HA. */
export function securityTypeFromKeyMgmt(keyMgmt: string): SecurityType {
  const suites = keyMgmt.split(/\s+/);
  const hasSae = suites.includes('SAE');
  const hasPsk = suites.some((s) => s === 'WPA-PSK' || s === 'WPA-PSK-SHA256');
  if (hasSae && hasPsk) return 'WPA2/WPA3-Mixed';
  if (hasSae) return 'WPA3-SAE';
  return 'WPA2-PSK';
}

/** Return why a network cannot be written as is, or null when it can. */
export function validateNetworkConfig(ssid: string, password: string, securityType: string): string | null {
  if (!isSecurityType(securityType)) {
    return `Unknown security type: ${securityType}`;
  }
  // hostapd counts the SSID in bytes (802.11 limit: 32 octets), not in characters.
  const ssidBytes = Buffer.byteLength(ssid ?? '', 'utf8');
  if (ssidBytes === 0 || ssidBytes > 32) {
    return 'SSID must be between 1 and 32 bytes';
  }
  // Values are written verbatim as `ssid=` / passphrase lines.
  if (!Validators.isConfigSafeLine(ssid)) {
    return 'SSID contains invalid characters';
  }
  if (securityType === 'Open') {
    return null;
  }
  if (securityType === 'WPA3-SAE') {
    // An SAE password is any byte string: any script is fine, only line breaks are not.
    if (!password || [...password].length < 8 || !Validators.isConfigSafeLine(password)) {
      return 'Password must be at least 8 characters, without control characters';
    }
    return null;
  }
  // A WPA2 passphrase (also used by mixed mode) is 8 to 63 printable ASCII characters
  // (IEEE 802.11i): a WPA2 client could not derive the key from anything else.
  if (!password || password.length < 8 || password.length > 63 || !/^[\x20-\x7e]+$/.test(password)) {
    return 'WPA2 and mixed mode need a password of 8 to 63 printable ASCII characters';
  }
  return null;
}
