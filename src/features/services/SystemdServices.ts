// src/features/services/SystemdServices.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, HaDiscoveryPayload } from '../../core/types';
import { execute_argv } from '../../utils/exec';
import { Validators, rejectInvalid } from '../../utils/validators';
import logger from '../../utils/logger';

interface ServiceStatus {
  name: string;
  active: boolean;
  state: string; // active, failed, inactive
}

/**
 * Systemd Services Monitoring
 * Monitors critical system services and provides control
 */
export class SystemdServices extends BaseFeature {
  private services: string[] = [
    'docker',
    'libvirtd',
    'firewalld',
    'hostapd',
    'NetworkManager',
  ];

  // Host units this feature used to watch and must now retract from Home
  // Assistant. mosquitto moved into the home-manager Docker stack: the host
  // unit is gone, so its sensor read "inactive" forever and its restart
  // button restarted nothing.
  private retiredServices: string[] = ['mosquitto'];

  private serviceStatus: Map<string, ServiceStatus> = new Map();

  async publishDiscovery(): Promise<void> {
    for (const serviceName of this.retiredServices) {
      const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const base = `${this.deviceInfo.identifiers[0]}_service_${serviceId}`;
      // An empty retained config is MQTT discovery's "remove this entity".
      await this.mqttClient.publish(this.entityDiscoveryTopic('sensor', `${base}_status`), '', { qos: 1, retain: true });
      await this.mqttClient.publish(this.entityDiscoveryTopic('button', `${base}_restart`), '', { qos: 1, retain: true });
    }
    // Create sensor for each service
    for (const serviceName of this.services) {
      const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '_');

      // Status sensor
      const statusPayload: HaDiscoveryPayload = {
        unique_id: `${this.deviceInfo.identifiers[0]}_service_${serviceId}_status`,
        name: `System Service ${serviceName} Status Sensor`,
        state_topic: this.prefixTopic(`${this.featureName}/${serviceId}/state`),
        json_attributes_topic: this.prefixTopic(`${this.featureName}/${serviceId}/attributes`),
        availability_topic: this.availabilityTopic,
        payload_available: this.payloadAvailable,
        payload_not_available: this.payloadNotAvailable,
        device: this.deviceInfo,
        icon: 'mdi:cog',
        entity_category: 'diagnostic',
      };

      const discoveryTopic = this.entityDiscoveryTopic('sensor', statusPayload.unique_id);
      await this.mqttClient.publish(discoveryTopic, JSON.stringify(statusPayload), { qos: 1, retain: true });

      // Restart button
      const restartPayload: HaDiscoveryPayload = {
        unique_id: `${this.deviceInfo.identifiers[0]}_service_${serviceId}_restart`,
        name: `System Service ${serviceName} Restart Button`,
        command_topic: this.prefixTopic(`${this.featureName}/${serviceId}/restart`),
        availability_topic: this.availabilityTopic,
        payload_available: this.payloadAvailable,
        payload_not_available: this.payloadNotAvailable,
        device: this.deviceInfo,
        icon: 'mdi:restart',
        entity_category: 'config',
      };

      const restartDiscoveryTopic = this.entityDiscoveryTopic('button', restartPayload.unique_id);
      await this.mqttClient.publish(restartDiscoveryTopic, JSON.stringify(restartPayload), { qos: 1, retain: true });
    }
  }

  async update(): Promise<void> {
    try {
      for (const serviceName of this.services) {
        await this.checkService(serviceName);
      }
    } catch (error) {
      logger.error('Error updating systemd services:', error);
    }
  }

  private async checkService(serviceName: string): Promise<void> {
    try {
      const unit = `${serviceName}.service`;
      if (!Validators.isSystemdUnit(unit)) {
        rejectInvalid('systemd_unit', unit, 'systemd_services');
        return;
      }
      const result = await execute_argv('systemctl', ['is-active', unit]);
      const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '_');

      const state = result.stdout?.trim() || 'unknown';
      const isActive = state === 'active';

      this.serviceStatus.set(serviceName, {
        name: serviceName,
        active: isActive,
        state: state,
      });

      // Publish state
      const stateTopic = this.prefixTopic(`${this.featureName}/${serviceId}/state`);
      const stateValue = isActive ? 'active' : state;
      await this.mqttClient.publish(
        stateTopic,
        stateValue,
        { qos: 0, retain: true }
      );

      // Publish attributes
      const attributes = {
        service: serviceName,
        state: state,
        active: isActive,
      };

      const attrTopic = this.prefixTopic(`${this.featureName}/${serviceId}/attributes`);
      await this.mqttClient.publish(
        attrTopic,
        JSON.stringify(attributes),
        { qos: 0, retain: true }
      );
    } catch (error) {
      logger.error(`Error checking service ${serviceName}:`, error);
    }
  }

  async setup(): Promise<void> {
    for (const serviceName of this.services) {
      const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const restartTopic = this.prefixTopic(`${this.featureName}/${serviceId}/restart`);

      this.mqttClient.subscribe(restartTopic, { qos: 1 });
    }

    this.listenToMessages(async (topic: string, message: Buffer) => {
      const topicStr = topic.toString();

      for (const serviceName of this.services) {
        const serviceId = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const restartTopic = this.prefixTopic(`${this.featureName}/${serviceId}/restart`);

        if (topicStr === restartTopic) {
          await this.restartService(serviceName);
        }
      }
    });
  }

  private async restartService(serviceName: string): Promise<void> {
    logger.info(`Restarting service: ${serviceName}`);

    try {
      const unit = `${serviceName}.service`;
      if (!Validators.isSystemdUnit(unit)) {
        rejectInvalid('systemd_unit', unit, 'systemd_services');
        return;
      }
      const result = await execute_argv('sudo', ['systemctl', 'restart', unit]);

      if (result.exitCode === 0) {
        logger.info(`Service ${serviceName} restarted successfully`);
        // Wait a bit before checking status
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.checkService(serviceName);
      } else {
        logger.error(`Failed to restart service ${serviceName}:`, result.stderr);
      }
    } catch (error) {
      logger.error(`Error restarting service ${serviceName}:`, error);
    }
  }

  async cleanup(): Promise<void> {
    // Unsubscribe from topics if needed
  }
}
