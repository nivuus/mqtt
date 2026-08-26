// src/features/memory/MemoryUsage.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient } from '../../core/types';
import * as si from 'systeminformation';
import logger from '../../utils/logger';

export class MemoryUsage extends BaseFeature {
  constructor(mqttClient: MqttClient, featureName: string = 'memory_usage') {
    super(mqttClient, featureName);
  }

  protected async publishDiscovery(): Promise<void> {
    const memoryUsagePayload = {
      name: `Memory Usage`,
      state_topic: this.prefixTopic(`${this.featureName}/state`),
      unit_of_measurement: '%',
      icon: 'mdi:memory',
      entity_category: 'diagnostic' as 'diagnostic',
      state_class: 'measurement' as 'measurement',
      json_attributes_topic: this.prefixTopic(`${this.featureName}/attributes`),
    };
    await this.publishEntityDiscovery('sensor', 'usage_percent', memoryUsagePayload);

    const memoryAvailablePayload = {
        name: `Memory Available`,
        state_topic: this.prefixTopic(`${this.featureName}/available_mb/state`),
        unit_of_measurement: 'MB',
        icon: 'mdi:memory',
        entity_category: 'diagnostic' as 'diagnostic',
        state_class: 'measurement' as 'measurement',
      };
    await this.publishEntityDiscovery('sensor', 'available_mb', memoryAvailablePayload);
  }

  protected async update(): Promise<void> {
    try {
      const memData = await si.mem();

      const totalMb = memData.total / (1024 * 1024);
      const usedMb = memData.used / (1024 * 1024);
      const activeMb = memData.active / (1024 * 1024); // active is often more representative of "used" by applications
      const availableMb = memData.available / (1024 * 1024);
      
      // Calculate usage percentage based on 'active' memory if available, otherwise 'used'
      // Some systems report 'used' including cache/buffers, 'active' is often better for "application used"
      const usagePercent = ((memData.active > 0 ? activeMb : usedMb) / totalMb) * 100;

      if (!isNaN(usagePercent)) {
        await this.publishState(`${this.featureName}/state`, usagePercent.toFixed(1));
      }
      if(!isNaN(availableMb)) {
        await this.publishState(`${this.featureName}/available_mb/state`, availableMb.toFixed(0));
      }

      const attributes = {
        total_mb: totalMb.toFixed(0),
        used_mb: usedMb.toFixed(0),
        active_mb: activeMb.toFixed(0),
        free_mb: (memData.free / (1024 * 1024)).toFixed(0),
        buffers_mb: (memData.buffers / (1024 * 1024)).toFixed(0),
        cached_mb: (memData.cached / (1024 * 1024)).toFixed(0),
        slab_mb: (memData.slab / (1024 * 1024)).toFixed(0),
        swap_total_mb: (memData.swaptotal / (1024 * 1024)).toFixed(0),
        swap_used_mb: (memData.swapused / (1024 * 1024)).toFixed(0),
        swap_free_mb: (memData.swapfree / (1024 * 1024)).toFixed(0),
      };
      // Filter out attributes with NaN or undefined values that might result from toFixed if original value was null/undefined
      Object.keys(attributes).forEach(key => {
        const value = (attributes as any)[key];
        if (value === undefined || value === null || String(value).includes('NaN')) {
          delete (attributes as any)[key];
        }
      });
      await this.publishAttributes(`${this.featureName}/attributes`, attributes, true);

    } catch (error) {
      logger.error(`Error updating memory usage for ${this.featureName}:`, error);
    }
  }
}
