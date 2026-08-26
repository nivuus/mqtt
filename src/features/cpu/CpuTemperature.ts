// src/features/cpu/CpuTemperature.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient } from '../../core/types';
import * as si from 'systeminformation';
import logger from '../../utils/logger';

export class CpuTemperature extends BaseFeature {
  constructor(mqttClient: MqttClient, featureName: string = 'cpu_temperature') {
    super(mqttClient, featureName);
  }

  protected async publishDiscovery(): Promise<void> {
    const discoveryPromises: Promise<void>[] = [];

    // Main CPU package temperature
    const mainPayload = {
      name: `CPU Temperature`,
      state_topic: this.prefixTopic(`${this.featureName}/main/state`),
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement' as 'measurement',
      entity_category: 'diagnostic' as 'diagnostic', // Explicitly type 'diagnostic'
      json_attributes_topic: this.prefixTopic(`${this.featureName}/main/attributes`),
    };
    discoveryPromises.push(this.publishEntityDiscovery('sensor', 'main_temp', mainPayload));

    // Per-core temperatures (if available)
    try {
      const cpuTempData = await si.cpuTemperature();
      if (cpuTempData.cores && cpuTempData.cores.length > 0) {
        cpuTempData.cores.forEach((coreTemp, index) => {
          if (coreTemp !== null) { // Some systems might report null for some cores
            const corePayload = {
              name: `CPU Core ${index + 1} Temperature`,
              state_topic: this.prefixTopic(`${this.featureName}/core_${index + 1}/state`),
              unit_of_measurement: '°C',
              device_class: 'temperature',
              state_class: 'measurement' as 'measurement',
              entity_category: 'diagnostic' as 'diagnostic', // Explicitly type 'diagnostic'
            };
            discoveryPromises.push(this.publishEntityDiscovery('sensor', `core_${index + 1}_temp`, corePayload));
          }
        });
      }
      // Socket temperatures (if available)
      // If systeminformation doesn't provide socket temps but we have main temp, create a socket sensor anyway
      if (cpuTempData.socket && cpuTempData.socket.length > 0) {
        cpuTempData.socket.forEach((socketTemp, index) => {
          if (socketTemp !== null) {
            const socketPayload = {
              name: `CPU Socket ${index + 1} Temperature`,
              state_topic: this.prefixTopic(`${this.featureName}/socket_${index + 1}/state`),
              unit_of_measurement: '°C',
              device_class: 'temperature',
              state_class: 'measurement' as 'measurement',
              entity_category: 'diagnostic' as 'diagnostic',
            };
            discoveryPromises.push(this.publishEntityDiscovery('sensor', `socket_${index + 1}_temp`, socketPayload));
          }
        });
      } else if (cpuTempData.main !== null && cpuTempData.main !== -1) {
        // Create a socket sensor using main temp if socket data not available
        const socketPayload = {
          name: `CPU Socket 1 Temperature`,
          state_topic: this.prefixTopic(`${this.featureName}/socket_1/state`),
          unit_of_measurement: '°C',
          device_class: 'temperature',
          state_class: 'measurement' as 'measurement',
          entity_category: 'diagnostic' as 'diagnostic',
        };
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `socket_1_temp`, socketPayload));
      }
    } catch (error) {
      logger.warn(`Could not get detailed CPU core/socket temperatures for discovery: ${error}`);
      // Proceed with main temperature discovery at least
    }
    await Promise.all(discoveryPromises);
  }

  protected async update(): Promise<void> {
    try {
      const temp = await si.cpuTemperature();

      // Determine main temperature: use temp.main if available, otherwise calculate from cores
      let mainTemp: number | null = null;
      if (temp.main !== null && temp.main !== -1) {
        mainTemp = temp.main;
      } else if (temp.cores && temp.cores.length > 0) {
        // Calculate average from cores if main temp is not available
        const validCoreTemps = temp.cores.filter(t => t !== null && t !== -1) as number[];
        if (validCoreTemps.length > 0) {
          mainTemp = Math.max(...validCoreTemps); // Use max core temp as main
          logger.debug(`Main CPU temperature calculated from cores: ${mainTemp}°C`);
        }
      }

      if (mainTemp !== null) {
        await this.publishState(`${this.featureName}/main/state`, mainTemp.toFixed(1), true);
      } else {
        logger.warn(`Main CPU temperature not available for ${this.featureName}.`);
        await this.publishState(`${this.featureName}/main/state`, 'unavailable', true);
      }

      const attributes: any = { max: temp.max };
      if (temp.chipset !== null) attributes.chipset = temp.chipset;
      await this.publishAttributes(`${this.featureName}/main/attributes`, attributes, true);


      if (temp.cores && temp.cores.length > 0) {
        await Promise.all(
          temp.cores.map(async (coreTemp, index) => {
            if (coreTemp !== null) {
              await this.publishState(`${this.featureName}/core_${index + 1}/state`, coreTemp.toFixed(1), true);
            }
          })
        );
      }
      if (temp.socket && temp.socket.length > 0) {
        await Promise.all(
          temp.socket.map(async (socketTemp, index) => {
            if (socketTemp !== null) {
              await this.publishState(`${this.featureName}/socket_${index + 1}/state`, socketTemp.toFixed(1), true);
            }
          })
        );
      } else if (mainTemp !== null) {
        // Publish socket temp using main temp if socket data not available (Package id 0 fallback)
        await this.publishState(`${this.featureName}/socket_1/state`, mainTemp.toFixed(1), true);
      }
    } catch (error) {
      logger.error(`Error updating CPU temperature for ${this.featureName}:`, error);
    }
  }
}
