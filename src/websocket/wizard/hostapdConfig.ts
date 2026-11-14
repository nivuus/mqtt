// src/websocket/wizard/hostapdConfig.ts
//
// The hostapd files the wizard may touch, and the band each one serves. Reading and
// editing them is the Wi-Fi feature's job (src/features/wifi/): the wizard has no
// text editor of its own.

export const HOSTAPD_CONFIG_24GHZ = '/etc/hostapd/2.4Ghz.conf';
export const HOSTAPD_CONFIG_5GHZ = '/etc/hostapd/5Ghz.conf';

// hostapd config files the wizard is allowed to touch. Any config path received
// from a wizard command must be one of these (prevents arbitrary file writes).
export const ALLOWED_HOSTAPD_CONFIGS: readonly string[] = [HOSTAPD_CONFIG_24GHZ, HOSTAPD_CONFIG_5GHZ];

/** Band label sent by the wizard -> radio file. */
export const HOSTAPD_CONFIG_BY_BAND: ReadonlyMap<string, string> = new Map([
  ['2.4GHz', HOSTAPD_CONFIG_24GHZ],
  ['5GHz', HOSTAPD_CONFIG_5GHZ],
]);

export function bandOfConfig(configPath: string): string {
  return configPath === HOSTAPD_CONFIG_5GHZ ? '5GHz' : '2.4GHz';
}
