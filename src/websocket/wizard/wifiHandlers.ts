// src/websocket/wizard/wifiHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';
import logger from '../../utils/logger';
import { writeRootFile } from './rootFile';
import {
  ALLOWED_HOSTAPD_CONFIGS, HOSTAPD_CONFIG_24GHZ, HOSTAPD_CONFIG_5GHZ,
  extractHostapdValue, updateHostapdValue, getSecurityConfig,
} from './hostapdConfig';

export function createWifiHandlers(): FeatureHandlers {
  const configPaths = [HOSTAPD_CONFIG_24GHZ, HOSTAPD_CONFIG_5GHZ];

  return {
    get_networks: async () => {
      const networks: Array<{
        ssid: string;
        password?: string;
        security: string;
        band: string;
        channel?: number;
        enabled: boolean;
        configPath: string;
      }> = [];

      // Check if hostapd is running (argv: exit 0 + "active" means running)
      const hostapdStatus = await execute_argv('systemctl', ['is-active', 'hostapd']);
      const hostapdActive = hostapdStatus.stdout.trim() === 'active';

      for (const configPath of configPaths) {
        try {
          const result = await execute_argv('cat', [configPath]);
          if (result.exitCode !== 0) continue;

          const content = result.stdout;
          const ssid = extractHostapdValue(content, 'ssid');
          const wpa = extractHostapdValue(content, 'wpa');
          const wpaKeyMgmt = extractHostapdValue(content, 'wpa_key_mgmt');
          const channel = extractHostapdValue(content, 'channel');
          const password = extractHostapdValue(content, 'wpa_passphrase');

          let security = 'Open';
          if (wpa === '2' && wpaKeyMgmt?.includes('WPA-PSK')) security = 'WPA2-PSK';
          if (wpa === '2' && wpaKeyMgmt?.includes('SAE')) security = 'WPA3-SAE';
          if (wpa === '3' || (wpaKeyMgmt?.includes('WPA-PSK') && wpaKeyMgmt?.includes('SAE'))) security = 'WPA2/WPA3-Mixed';

          const band = configPath.includes('2.4') ? '2.4GHz' : '5GHz';

          if (ssid) {
            networks.push({
              ssid,
              password: password || undefined,
              security,
              band,
              channel: channel ? parseInt(channel) : undefined,
              enabled: hostapdActive && !!ssid,
              configPath,
            });
          }
        } catch (error) {
          logger.error(`Error reading hostapd config ${configPath}:`, error);
        }
      }

      return networks;
    },

    add_network: async (params) => {
      const { ssid, password, security = 'WPA2-PSK', band = '2.4GHz' } = params as {
        ssid: string; password: string; security?: string; band?: string;
      };
      if (!ssid || !password) throw new Error('Missing ssid or password parameter');
      // SSID/passphrase are written verbatim into the config file — reject
      // control characters that would corrupt it (or inject extra directives).
      if (!Validators.isConfigSafeLine(ssid) || !Validators.isConfigSafeLine(password)) {
        throw new Error('Invalid characters in ssid or password');
      }

      const configPath = band === '5GHz' ? HOSTAPD_CONFIG_5GHZ : HOSTAPD_CONFIG_24GHZ;

      // Read existing config
      const existing = await execute_argv('cat', [configPath]);
      let content = existing.stdout;

      // Update SSID and password
      content = updateHostapdValue(content, 'ssid', ssid);
      content = updateHostapdValue(content, 'wpa_passphrase', password);

      // Update security settings
      const securityConfig = getSecurityConfig(security);
      content = updateHostapdValue(content, 'wpa', securityConfig.wpa);
      content = updateHostapdValue(content, 'wpa_key_mgmt', securityConfig.wpa_key_mgmt);
      if (securityConfig.rsn_pairwise) {
        content = updateHostapdValue(content, 'rsn_pairwise', securityConfig.rsn_pairwise);
      }

      // Write config and reload
      await writeRootFile(configPath, content);
      await execute_argv('sudo', ['systemctl', 'reload', 'hostapd']);

      return { success: true, ssid, band };
    },

    delete_network: async (params) => {
      // For simplicity, we just clear the SSID - in reality you might want to disable the interface
      const { configPath } = params as { configPath: string };
      if (!configPath) throw new Error('Missing configPath parameter');
      // configPath is wizard-controlled — restrict it to the known hostapd files.
      if (!ALLOWED_HOSTAPD_CONFIGS.includes(configPath)) throw new Error('Invalid configPath parameter');

      // Set SSID to empty or disable
      const existing = await execute_argv('cat', [configPath]);
      const content = updateHostapdValue(existing.stdout, 'ssid', '');

      await writeRootFile(configPath, content);
      await execute_argv('sudo', ['systemctl', 'reload', 'hostapd']);

      return { success: true };
    },

    reload: async () => {
      await execute_argv('sudo', ['systemctl', 'reload', 'hostapd']);
      return { success: true };
    },
  };
}
