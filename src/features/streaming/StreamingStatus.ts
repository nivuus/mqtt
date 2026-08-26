// src/features/streaming/StreamingStatus.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, HaDiscoveryPayload } from '../../core/types';
import { createWinRMClient } from '../../utils/winrm';
import { isWindowsVmRunning } from '../../utils/vmState';
import logger from '../../utils/logger';

interface StreamingState {
  active: boolean;
  service: string | null; // sunshine, moonlight, parsec
  processCount: number;
}

/**
 * Streaming Status Monitoring
 * Detects active streaming sessions (Sunshine, Moonlight, Parsec) on Windows VM
 */
export class StreamingStatus extends BaseFeature {
  private state: StreamingState = {
    active: false,
    service: null,
    processCount: 0,
  };
  private winrmClient = createWinRMClient();

  async publishDiscovery(): Promise<void> {
    // Streaming status binary sensor
    const statusPayload: HaDiscoveryPayload = {
      unique_id: `${this.deviceInfo.identifiers[0]}_streaming_status`,
      name: `VM Streaming Active Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/active/state`),
      json_attributes_topic: this.prefixTopic(`${this.featureName}/active/attributes`),
      availability_topic: this.availabilityTopic,
      payload_available: this.payloadAvailable,
      payload_not_available: this.payloadNotAvailable,
      device: this.deviceInfo,
      icon: 'mdi:cast',
      entity_category: 'diagnostic',
      payload_on: 'ON',
      payload_off: 'OFF',
    };

    const discoveryTopic = `homeassistant/binary_sensor/${this.deviceInfo.identifiers[0]}/${statusPayload.unique_id}/config`;
    await this.mqttClient.publish(discoveryTopic, JSON.stringify(statusPayload), { qos: 1, retain: true });

    // Streaming service sensor
    const servicePayload: HaDiscoveryPayload = {
      unique_id: `${this.deviceInfo.identifiers[0]}_streaming_service`,
      name: `VM Streaming Service Sensor`,
      state_topic: this.prefixTopic(`${this.featureName}/service/state`),
      availability_topic: this.availabilityTopic,
      payload_available: this.payloadAvailable,
      payload_not_available: this.payloadNotAvailable,
      device: this.deviceInfo,
      icon: 'mdi:application',
      entity_category: 'diagnostic',
    };

    const serviceDiscoveryTopic = `homeassistant/sensor/${this.deviceInfo.identifiers[0]}/${servicePayload.unique_id}/config`;
    await this.mqttClient.publish(serviceDiscoveryTopic, JSON.stringify(servicePayload), { qos: 1, retain: true });
  }

  async update(): Promise<void> {
    if (!await isWindowsVmRunning()) {
      logger.debug(`[${this.featureName}] Windows VM not running, skipping`);
      return;
    }
    try {
      await this.checkStreamingProcesses();
      await this.publishStreamingState();
    } catch (error) {
      logger.error('Error updating streaming status:', error);
    }
  }

  private async checkStreamingProcesses(): Promise<void> {
    try {
      // Check for Sunshine process via WinRM directly
      const sunshineActive = await this.winrmClient.isProcessRunning('sunshine.exe');

      // Check for Parsec process
      const parsecActive = await this.winrmClient.isProcessRunning('parsecd.exe');

      // Check for Moonlight (usually server-side, but check anyway)
      const moonlightActive = await this.winrmClient.isProcessRunning('moonlight.exe');

      // Determine active service
      if (sunshineActive) {
        this.state = { active: true, service: 'Sunshine', processCount: 1 };
      } else if (parsecActive) {
        this.state = { active: true, service: 'Parsec', processCount: 1 };
      } else if (moonlightActive) {
        this.state = { active: true, service: 'Moonlight', processCount: 1 };
      } else {
        this.state = { active: false, service: null, processCount: 0 };
      }

      logger.debug(`Streaming status: active=${this.state.active}, service=${this.state.service}`);
    } catch (error) {
      logger.error('Error checking streaming processes:', error);
      this.state = { active: false, service: null, processCount: 0 };
    }
  }

  private async publishStreamingState(): Promise<void> {
    // Publish active/inactive state
    await this.mqttClient.publish(
      this.prefixTopic(`${this.featureName}/active/state`),
      this.state.active ? 'ON' : 'OFF',
      { qos: 0, retain: true }
    );

    // Publish attributes
    const attributes = {
      active: this.state.active,
      service: this.state.service || 'None',
      process_count: this.state.processCount,
    };

    await this.mqttClient.publish(
      this.prefixTopic(`${this.featureName}/active/attributes`),
      JSON.stringify(attributes),
      { qos: 0, retain: true }
    );

    // Publish service name
    await this.mqttClient.publish(
      this.prefixTopic(`${this.featureName}/service/state`),
      this.state.service || 'None',
      { qos: 0, retain: true }
    );
  }

  async setup(): Promise<void> {
    // No setup needed
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
  }
}
