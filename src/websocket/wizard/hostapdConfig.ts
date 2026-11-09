// src/websocket/wizard/hostapdConfig.ts
//
// hostapd config file paths and the key=value helpers used to read and edit them.

export const HOSTAPD_CONFIG_24GHZ = '/etc/hostapd/2.4Ghz.conf';
export const HOSTAPD_CONFIG_5GHZ = '/etc/hostapd/5Ghz.conf';

// hostapd config files the wizard is allowed to touch. Any config path received
// from a wizard command must be one of these (prevents arbitrary file writes).
export const ALLOWED_HOSTAPD_CONFIGS: readonly string[] = [HOSTAPD_CONFIG_24GHZ, HOSTAPD_CONFIG_5GHZ];

export function extractHostapdValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

export function updateHostapdValue(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (content.match(regex)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content + `\n${key}=${value}`;
}

export function getSecurityConfig(security: string): { wpa: string; wpa_key_mgmt: string; rsn_pairwise?: string } {
  switch (security) {
    case 'WPA2-PSK':
      return { wpa: '2', wpa_key_mgmt: 'WPA-PSK', rsn_pairwise: 'CCMP' };
    case 'WPA3-SAE':
      return { wpa: '2', wpa_key_mgmt: 'SAE', rsn_pairwise: 'CCMP' };
    case 'WPA2/WPA3-Mixed':
      return { wpa: '2', wpa_key_mgmt: 'WPA-PSK SAE', rsn_pairwise: 'CCMP' };
    case 'Open':
    default:
      return { wpa: '0', wpa_key_mgmt: '' };
  }
}
