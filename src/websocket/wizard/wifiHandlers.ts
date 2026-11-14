// src/websocket/wizard/wifiHandlers.ts
//
// Wizard Wi-Fi actions. Every file edit, validation and hostapd command goes through
// the Wi-Fi feature (src/features/wifi/), the same code Home Assistant's own entities
// use: a new network is a new BSS, a radio's main network is never rewritten by an
// add or a delete, and any failure is thrown to the caller instead of answered as done.

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { SecurityType, validateNetworkConfig } from '../../features/wifi/securityProfiles';
import {
  addBss, defaultBridge, listBridges, parseNetworkConfig, radioSetting, removeNetwork,
} from '../../features/wifi/hostapdConfigText';
import {
  ApplyMode, applyToHostapd, readHostapdConfig, writeHostapdConfig,
} from '../../features/wifi/hostapdService';
import { ALLOWED_HOSTAPD_CONFIGS, HOSTAPD_CONFIG_BY_BAND, bandOfConfig } from './hostapdConfig';

interface WizardNetwork {
  ssid: string;
  security: SecurityType;
  band: string;
  channel?: number;
  enabled: boolean;
  configPath: string;
  isPrimary: boolean;
  bridge?: string;
}

/** Hand the change to hostapd; a command that failed is an error for the caller. */
async function applyOrThrow(mode: ApplyMode): Promise<void> {
  const result = await applyToHostapd(mode);
  if (!result.ok) throw new Error(result.detail);
}

async function getNetworks(): Promise<WizardNetwork[]> {
  const hostapdStatus = await execute_argv('systemctl', ['is-active', 'hostapd'], { quiet: true });
  const hostapdActive = hostapdStatus.stdout.trim() === 'active';
  const networks: WizardNetwork[] = [];
  for (const configPath of ALLOWED_HOSTAPD_CONFIGS) {
    const content = await readHostapdConfig(configPath);
    const channel = radioSetting(content, 'channel');
    // Passphrases stay on the host: the wizard only needs to know what exists.
    for (const network of parseNetworkConfig(content, configPath).values()) {
      networks.push({
        ssid: network.ssid,
        security: network.securityType,
        band: bandOfConfig(configPath),
        channel: channel ? parseInt(channel, 10) : undefined,
        enabled: hostapdActive,
        configPath,
        isPrimary: network.isPrimary,
        bridge: network.bridge,
      });
    }
  }
  return networks;
}

async function addNetwork(params: Record<string, unknown>): Promise<unknown> {
  const { ssid, password = '', security = 'WPA2-PSK', band = '2.4GHz' } = params;
  if (typeof ssid !== 'string' || typeof password !== 'string'
      || typeof security !== 'string' || typeof band !== 'string') {
    throw new Error('Missing ssid or password parameter');
  }
  const configPath = HOSTAPD_CONFIG_BY_BAND.get(band);
  if (!configPath) throw new Error(`Unknown band: ${band}`);
  const invalid = validateNetworkConfig(ssid, password, security);
  if (invalid) throw new Error(invalid);

  const content = await readHostapdConfig(configPath);
  const existing = parseNetworkConfig(content, configPath);
  if (existing.has(ssid)) throw new Error(`Network ${ssid} already exists on ${band}`);
  const bridge = defaultBridge(existing.values(), listBridges(content));
  if (!bridge) throw new Error(`No bridge= line in ${configPath}: cannot attach a new network`);

  const updated = addBss(content, { ssid, password, securityType: security as SecurityType, bridge });
  await writeHostapdConfig(configPath, updated.content);
  // A new BSS is a new virtual interface: a reload cannot create it.
  await applyOrThrow('restart');
  return { success: true, ssid, band };
}

async function deleteNetwork(params: Record<string, unknown>): Promise<unknown> {
  const { configPath, ssid } = params;
  if (!configPath) throw new Error('Missing configPath parameter');
  // configPath is wizard-controlled — restrict it to the known hostapd files.
  if (typeof configPath !== 'string' || !ALLOWED_HOSTAPD_CONFIGS.includes(configPath)) {
    throw new Error('Invalid configPath parameter');
  }
  if (typeof ssid !== 'string' || !ssid) throw new Error('Missing ssid parameter');

  // removeNetwork refuses the radio's main network and an SSID that is not there.
  const updated = removeNetwork(await readHostapdConfig(configPath), ssid);
  await writeHostapdConfig(configPath, updated);
  await applyOrThrow('restart');
  return { success: true };
}

export function createWifiHandlers(): FeatureHandlers {
  return {
    get_networks: getNetworks,
    add_network: addNetwork,
    delete_network: deleteNetwork,
    reload: async () => {
      await applyOrThrow('reload');
      return { success: true };
    },
  };
}
