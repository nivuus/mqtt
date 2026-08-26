// src/features/cpu/CpuLoad.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient } from '../../core/types';
import * as si from 'systeminformation';
import logger from '../../utils/logger';

export class CpuLoad extends BaseFeature {
  private previousLoads: si.Systeminformation.CurrentLoadCpuData[] = [];

  constructor(mqttClient: MqttClient, featureName: string = 'cpu_load') {
    super(mqttClient, featureName);
  }

  protected async publishDiscovery(): Promise<void> {
    const discoveryPromises: Promise<void>[] = [];

    // Overall CPU load
    const avgPayload = {
      name: `CPU Load Average`,
      state_topic: this.prefixTopic(`${this.featureName}/average/state`),
      unit_of_measurement: '%',
      icon: 'mdi:gauge',
      entity_category: 'diagnostic' as 'diagnostic',
      state_class: 'measurement' as 'measurement',
      json_attributes_topic: this.prefixTopic(`${this.featureName}/average/attributes`),
    };
    discoveryPromises.push(this.publishEntityDiscovery('sensor', 'avg_load', avgPayload));

    // Per-core loads (if data is available)
    try {
      // Fetch initial load to determine number of cores for discovery
      const currentLoad = await si.currentLoad();
      if (currentLoad.cpus && currentLoad.cpus.length > 0) {
        currentLoad.cpus.forEach((coreLoad, index) => {
          const corePayload = {
            name: `CPU Core ${index + 1} Load`,
            state_topic: this.prefixTopic(`${this.featureName}/core_${index + 1}/state`),
            unit_of_measurement: '%',
            icon: 'mdi:gauge-low', // Or mdi:gauge, mdi:gauge-high based on value potentially
            entity_category: 'diagnostic' as 'diagnostic',
            state_class: 'measurement' as 'measurement',
            json_attributes_topic: this.prefixTopic(`${this.featureName}/core_${index + 1}/attributes`),
          };
          discoveryPromises.push(this.publishEntityDiscovery('sensor', `core_${index + 1}_load`, corePayload));
        });
      }
    } catch (error) {
      logger.warn(`Could not get detailed CPU core loads for discovery: ${error}`);
    }
    await Promise.all(discoveryPromises);
  }

  protected async update(): Promise<void> {
    try {
      const currentLoad = await si.currentLoad();

      // Average load
      if (currentLoad.currentLoad !== null) {
        await this.publishState(`${this.featureName}/average/state`, currentLoad.currentLoad.toFixed(2));
        const avgAttributes = {
            currentLoadUser: currentLoad.currentLoadUser?.toFixed(2),
            currentLoadSystem: currentLoad.currentLoadSystem?.toFixed(2),
            currentLoadNice: currentLoad.currentLoadNice?.toFixed(2),
            currentLoadIdle: currentLoad.currentLoadIdle?.toFixed(2),
            currentLoadIrq: currentLoad.currentLoadIrq?.toFixed(2),
            avgLoad: currentLoad.avgLoad?.toFixed(2) // systeminformation's avgLoad is different from currentLoad
        };
        // Filter out undefined attributes
        Object.keys(avgAttributes).forEach(key => (avgAttributes as any)[key] === undefined && delete (avgAttributes as any)[key]);
        await this.publishAttributes(`${this.featureName}/average/attributes`, avgAttributes, true);
      }

      // Per-core loads
      if (currentLoad.cpus && currentLoad.cpus.length > 0) {
        await Promise.all(
          currentLoad.cpus.map(async (coreLoadData, index) => {
            if (coreLoadData.load !== null) {
              await this.publishState(`${this.featureName}/core_${index + 1}/state`, coreLoadData.load.toFixed(2));
              const coreAttributes = {
                  loadUser: coreLoadData.loadUser?.toFixed(2),
                  loadSystem: coreLoadData.loadSystem?.toFixed(2),
                  loadNice: coreLoadData.loadNice?.toFixed(2),
                  loadIdle: coreLoadData.loadIdle?.toFixed(2),
                  loadIrq: coreLoadData.loadIrq?.toFixed(2),
              };
              Object.keys(coreAttributes).forEach(key => (coreAttributes as any)[key] === undefined && delete (coreAttributes as any)[key]);
              await this.publishAttributes(`${this.featureName}/core_${index + 1}/attributes`, coreAttributes, true);
            }
          })
        );
      }
      this.previousLoads = currentLoad.cpus; // Store for next cycle if needed for diffs, though currentLoad is absolute
    } catch (error) {
      logger.error(`Error updating CPU load for ${this.featureName}:`, error);
    }
  }
}
