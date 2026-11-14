// src/features/network/PppoeCredentials.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { execute_command } from '../../utils/exec';
import { Validators, rejectInvalid } from '../../utils/validators';
import logger from '../../utils/logger';
import * as fs from 'fs';
import { isProfileActive, readStoredUsername, saveCredentials } from './pppoeProfile';

interface PppoeCredentialsFeatureConfig extends FeatureConfig {
  chap_secrets_path?: string;
  pap_secrets_path?: string;
  nmconnection_path?: string;
}

const DEFAULT_CHAP_SECRETS_PATH = '/etc/ppp/chap-secrets';
const DEFAULT_PAP_SECRETS_PATH = '/etc/ppp/pap-secrets';
const DEFAULT_NMCONNECTION_PATH = '/etc/NetworkManager/system-connections/pppoe-enp6s0.835.nmconnection';

export class PppoeCredentials extends BaseFeature {
  protected featureConfig: PppoeCredentialsFeatureConfig;

  constructor(mqttClient: MqttClient, featureName: string = 'pppoe_credentials') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as PppoeCredentialsFeatureConfig ||
                         {
                           enabled: true,
                           update_interval_seconds: 3600 * 6, // Check every 6 hours
                           chap_secrets_path: DEFAULT_CHAP_SECRETS_PATH,
                           pap_secrets_path: DEFAULT_PAP_SECRETS_PATH,
                           nmconnection_path: DEFAULT_NMCONNECTION_PATH,
                         };
  }

  // Form values as typed in Home Assistant, staged until Save. The stored password is never
  // read into it: an empty password means "keep the one in the keyfile".
  private form = { username: '', password: '' };

  private async getPppoeConnectionStatus(): Promise<{
    status: string;
    interface?: string;
    ip?: string;
    gateway?: string;
    uptime?: string;
  }> {
    try {
      // Check if ppp0 interface exists and is up
      const interfaceCheck = await execute_command('ip addr show ppp0', false);
      
      if (interfaceCheck.exitCode === 0) {
        // Extract IP from interface info
        const ipMatch = interfaceCheck.stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : undefined;
        
        // Get gateway/remote IP
        const routeCheck = await execute_command('ip route show dev ppp0', false);
        const gatewayMatch = routeCheck.stdout.match(/default via (\d+\.\d+\.\d+\.\d+)/);
        const gateway = gatewayMatch ? gatewayMatch[1] : undefined;
        
        // Try to get connection uptime from systemctl if pppoe service exists
        let uptime: string | undefined;
        try {
          const statusCheck = await execute_command('systemctl status ppp@provider.service 2>/dev/null || systemctl status pppoe-server 2>/dev/null || true', false);
          const activeMatch = statusCheck.stdout.match(/Active:\s+active\s+\(running\)\s+since\s+(.+);/);
          if (activeMatch) {
            uptime = activeMatch[1];
          }
        } catch (error) {
          // Ignore systemctl errors
        }
        
        return {
          status: 'CONNECTED',
          interface: 'ppp0',
          ip,
          gateway,
          uptime
        };
      }
      
      return { status: 'DISCONNECTED' };
    } catch (error) {
      logger.error(`Error checking PPPoE connection status:`, error);
      return { status: 'ERROR' };
    }
  }

  protected async publishDiscovery(): Promise<void> {
    await this.publishEntityDiscovery('binary_sensor', 'config_found', {
      name: `Network PPPoE Config Status Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/config_status/state`),
      payload_on: "DETECTED",
      payload_off: "NOT_DETECTED",
      icon: 'mdi:file-key-outline',
      entity_category: 'diagnostic' as 'diagnostic',
    });

    await this.publishEntityDiscovery('sensor', 'connection_status', {
      name: `Network PPPoE Connection Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/connection/state`),
      icon: 'mdi:wan',
      entity_category: 'diagnostic' as 'diagnostic',
      json_attributes_topic: this.prefixTopic(`${this.featureName}/connection/attributes`),
    });

    await this.publishEntityDiscovery('sensor', 'credentials_count', {
      name: `Network PPPoE Credentials Count Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/credentials_count/state`),
      icon: 'mdi:account-key',
      entity_category: 'diagnostic' as 'diagnostic',
    });


    // PPPoE credentials management entities
    await this.publishEntityDiscovery('sensor', 'last_action', {
      name: `Network PPPoE Last Action Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/last_action/state`),
      icon: 'mdi:account-sync',
      entity_category: 'diagnostic' as 'diagnostic',
    });

    // Input text entities for PPPoE credentials
    await this.publishEntityDiscovery('text', 'username_input', {
      name: `Network PPPoE Username Input`,
      command_topic: this.prefixTopic(`${this.featureName}/username_input/set`),
      state_topic: this.prefixTopic(`${this.featureName}/username_input/state`),
      icon: 'mdi:account',
      entity_category: 'config' as 'config',
      mode: 'text',
    });

    await this.publishEntityDiscovery('text', 'password_input', {
      name: `Network PPPoE Password Input`,
      command_topic: this.prefixTopic(`${this.featureName}/password_input/set`),
      state_topic: this.prefixTopic(`${this.featureName}/password_input/state`),
      icon: 'mdi:key',
      entity_category: 'config' as 'config',
      // Masked on screen, still editable: Home Assistant renders it as a
      // password input.
      mode: 'password',
    });

    // Action buttons
    await this.publishEntityDiscovery('button', 'save_credentials_btn', {
      name: `Network Save PPPoE Credentials Button`,
      command_topic: this.prefixTopic(`${this.featureName}/command/save_credentials`),
      payload_press: 'SAVE_CREDENTIALS',
      icon: 'mdi:content-save',
      entity_category: 'config' as 'config',
    });

    await this.publishEntityDiscovery('button', 'test_connection_btn', {
      name: `Network Test PPPoE Connection Button`,
      command_topic: this.prefixTopic(`${this.featureName}/command/test_connection`),
      payload_press: 'TEST_CONNECTION',
      icon: 'mdi:connection',
      entity_category: 'config' as 'config',
    });

    // Initialize states - read real credentials from NetworkManager
    await this.publishState(`${this.featureName}/last_action/state`, 'Ready', true);

    const nmPath = this.featureConfig.nmconnection_path || DEFAULT_NMCONNECTION_PATH;
    let username = '';
    try {
      username = (await readStoredUsername(nmPath)) ?? '';
    } catch (error: any) {
      logger.warn(`Cannot read the PPPoE user name from ${nmPath}: ${error.message}`);
    }
    this.form = { username, password: '' };
    await this.publishTextState(`${this.featureName}/username_input/state`, username);
    // The ISP password is never published: a retained state is readable by every broker
    // account allowed on this tree and kept in Home Assistant's history. Publishing the empty
    // value on every start also overwrites a secret retained by an older agent.
    await this.publishTextState(`${this.featureName}/password_input/state`, '');
  }

  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  private async countCredentials(filePath: string): Promise<number> {
    // filePath is a fixed config path (never MQTT-controlled); a shell is used
    // here only for the `grep | echo` fallback. No external value is interpolated.
    try {
      const result = await execute_command(`grep -c "^[^#]" "${filePath}" 2>/dev/null || echo "0"`, false);
      return parseInt(result.stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  protected async update(): Promise<void> {
    const chapPath = this.featureConfig.chap_secrets_path || DEFAULT_CHAP_SECRETS_PATH;
    const papPath = this.featureConfig.pap_secrets_path || DEFAULT_PAP_SECRETS_PATH;
    let detected = false;
    let credentialsCount = 0;

    try {
      const chapExists = await this.checkFileExists(chapPath);
      if (chapExists) {
        logger.debug(`PPPoE CHAP secrets file found at ${chapPath}`);
        detected = true;
        credentialsCount += await this.countCredentials(chapPath);
      }

      const papExists = await this.checkFileExists(papPath);
      if (papExists) {
        logger.debug(`PPPoE PAP secrets file found at ${papPath}`);
        detected = true;
        credentialsCount += await this.countCredentials(papPath);
      }

      await this.publishState(`${this.featureName}/config_status/state`, detected ? "DETECTED" : "NOT_DETECTED", true);
      await this.publishState(`${this.featureName}/credentials_count/state`, credentialsCount.toString(), true);

      // Get connection status
      const connectionStatus = await this.getPppoeConnectionStatus();
      await this.publishState(`${this.featureName}/connection/state`, connectionStatus.status, true);
      
      if (connectionStatus.status === 'CONNECTED') {
        await this.publishState(`${this.featureName}/connection/attributes`, JSON.stringify({
          interface: connectionStatus.interface,
          ip: connectionStatus.ip,
          gateway: connectionStatus.gateway,
          uptime: connectionStatus.uptime
        }), true);
      }

    } catch (error: any) {
      logger.error(`Error checking for PPPoE credential files for ${this.featureName}:`, error.message);
      await this.publishState(`${this.featureName}/config_status/state`, "ERROR", true);
      await this.publishState(`${this.featureName}/connection/state`, "ERROR", true);
    }
  }

  protected async setup(): Promise<void> {
    // Subscribe to command topics for PPPoE management
    const commandTopic = this.prefixTopic(`${this.featureName}/command/#`);
    // `+` is the MQTT single-level wildcard; a `*` is a literal character that matches nothing.
    const inputTopic = this.prefixTopic(`${this.featureName}/+/set`);
    
    await this.mqttClient.subscribe(commandTopic);
    await this.mqttClient.subscribe(inputTopic);
    
    this.listenToMessages(this.handleMqttMessage.bind(this));
  }

  private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
    const message = payload.toString();

    // Handle input states
    if (topic === this.prefixTopic(`${this.featureName}/username_input/set`)) {
      this.form.username = message;
      await this.publishTextState(`${this.featureName}/username_input/state`, message);
    } else if (topic === this.prefixTopic(`${this.featureName}/password_input/set`)) {
      this.form.password = message;
      await this.publishTextState(`${this.featureName}/password_input/state`, '');
      await this.publishState(`${this.featureName}/last_action/state`, 'New password staged; press Save to apply it', true);
    }

    // Handle action commands
    else if (topic === this.prefixTopic(`${this.featureName}/command/save_credentials`) && message === 'SAVE_CREDENTIALS') {
      await this.handleSaveCredentialsAction();
    } else if (topic === this.prefixTopic(`${this.featureName}/command/test_connection`) && message === 'TEST_CONNECTION') {
      await this.handleTestConnectionAction();
    }
  }

  private async handleSaveCredentialsAction(): Promise<void> {
    try {
      await this.publishState(`${this.featureName}/last_action/state`, 'Saving credentials...', true);

      // The values typed in Home Assistant, kept as they arrived. They used to
      // be read back with mosquitto_sub, which put the broker password on a
      // command line any local user could list.
      const newUsername = this.form.username.trim();
      const newPassword = this.form.password.trim();

      if (!newUsername) {
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Username required', true);
        return;
      }

      // Credentials are written verbatim into an INI file line — reject values
      // containing control characters (newlines, etc.) that would corrupt it.
      if (!Validators.isConfigSafeLine(newUsername) || !Validators.isConfigSafeLine(newPassword)) {
        rejectInvalid('pppoe_credentials', newUsername, this.featureName);
        await this.publishState(`${this.featureName}/last_action/state`, 'Error: Invalid characters in credentials', true);
        return;
      }

      const nmPath = this.featureConfig.nmconnection_path || DEFAULT_NMCONNECTION_PATH;
      const outcome = await saveCredentials(nmPath, newUsername, newPassword || undefined);
      if (!outcome.ok) {
        logger.error(`Saving PPPoE credentials for ${this.featureName} failed: ${outcome.error}`);
        await this.publishState(`${this.featureName}/last_action/state`, `Error: ${outcome.error}`, true);
        return;
      }
      this.form.password = '';
      await this.publishState(`${this.featureName}/last_action/state`, outcome.restarted
        ? 'Credentials saved; connection restarted'
        : 'Credentials saved; the connection is inactive and was left down', true);
      logger.info(`PPPoE credentials updated in ${nmPath}`);

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error during credential save';
      logger.error(`Error saving PPPoE credentials for ${this.featureName}:`, errorMessage);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${errorMessage}`, true);
    }
  }

  private async handleTestConnectionAction(): Promise<void> {
    try {
      await this.publishState(`${this.featureName}/last_action/state`, 'Testing connection...', true);
      
      // A status read of the NetworkManager profile: whether it is active. It never brings
      // the link up (the profile may be a fallback uplink kept down on purpose).
      const nmPath = this.featureConfig.nmconnection_path || DEFAULT_NMCONNECTION_PATH;
      const active = await isProfileActive(nmPath);
      await this.publishState(`${this.featureName}/last_action/state`, active ? 'Connection active' : 'Connection inactive', true);

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error during connection test';
      logger.error(`Error testing PPPoE connection for ${this.featureName}:`, errorMessage);
      await this.publishState(`${this.featureName}/last_action/state`, `Error: ${errorMessage}`, true);
    }
  }
}
