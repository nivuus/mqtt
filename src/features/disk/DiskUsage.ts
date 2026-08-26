// src/features/disk/DiskUsage.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import * as si from 'systeminformation';
import logger from '../../utils/logger';

interface DiskUsageFeatureConfig extends FeatureConfig {
  drives?: string[]; // Optional: specific drives/mount points to monitor, e.g., ["/", "/mnt/data"]
}

export class DiskUsage extends BaseFeature {
  protected featureConfig: DiskUsageFeatureConfig;

  constructor(mqttClient: MqttClient, featureName: string = 'disk_usage') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as DiskUsageFeatureConfig ||
                         { enabled: true, update_interval_seconds: 300 };
  }

  private getSafeObjectId(filesystemName: string): string {
    // Replace characters not suitable for MQTT topic segments or HA object IDs
    return filesystemName.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  protected async publishDiscovery(): Promise<void> {
    const discoveryPromises: Promise<void>[] = [];
    try {
      const fsSize = await si.fsSize();
      const drivesToMonitor = this.featureConfig.drives && this.featureConfig.drives.length > 0
        ? fsSize.filter(fs => this.featureConfig.drives!.includes(fs.fs) || this.featureConfig.drives!.includes(fs.mount))
        : fsSize.filter(fs => fs.type !== 'tmpfs' && fs.type !== 'squashfs' && fs.type !== 'devtmpfs'); // Default: monitor relevant, non-temporary filesystems

      for (const fs of drivesToMonitor) {
        const objectId = this.getSafeObjectId(fs.fs); // Use filesystem name for a more stable ID than mount point
        const friendlyName = `Disk ${fs.mount}`; // Use mount point for friendly name

        // Usage Percentage Sensor
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${objectId}_usage_percent`, {
          name: `${friendlyName} Usage`,
          state_topic: this.prefixTopic(`${this.featureName}/${objectId}/usage_percent/state`),
          unit_of_measurement: '%',
          icon: 'mdi:harddisk',
          entity_category: 'diagnostic' as 'diagnostic',
          state_class: 'measurement' as 'measurement',
          json_attributes_topic: this.prefixTopic(`${this.featureName}/${objectId}/attributes`),
        }));

        // Available Space Sensor
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${objectId}_available_gb`, {
          name: `${friendlyName} Available`,
          state_topic: this.prefixTopic(`${this.featureName}/${objectId}/available_gb/state`),
          unit_of_measurement: 'GB',
          icon: 'mdi:harddisk',
          entity_category: 'diagnostic' as 'diagnostic',
          state_class: 'measurement' as 'measurement',
        }));
      }
    } catch (error) {
      logger.error(`Error discovering disk usage for ${this.featureName}:`, error);
    }
    await Promise.all(discoveryPromises);
  }

  protected async update(): Promise<void> {
    try {
      const fsSize = await si.fsSize();
      const drivesToMonitor = this.featureConfig.drives && this.featureConfig.drives.length > 0
        ? fsSize.filter(fs => this.featureConfig.drives!.includes(fs.fs) || this.featureConfig.drives!.includes(fs.mount))
        : fsSize.filter(fs => fs.type !== 'tmpfs' && fs.type !== 'squashfs' && fs.type !== 'devtmpfs');

      for (const fs of drivesToMonitor) {
        const objectId = this.getSafeObjectId(fs.fs);
        const usagePercent = fs.use; // systeminformation provides 'use' as a percentage
        const availableGb = fs.available / (1024 * 1024 * 1024);
        const totalGb = fs.size / (1024 * 1024 * 1024);
        const usedGb = fs.used / (1024 * 1024 * 1024);

        if (usagePercent !== null && !isNaN(usagePercent)) {
          await this.publishState(`${this.featureName}/${objectId}/usage_percent/state`, usagePercent.toFixed(1), true);
        }
        if (!isNaN(availableGb)) {
            await this.publishState(`${this.featureName}/${objectId}/available_gb/state`, availableGb.toFixed(2), true);
        }

        const attributes = {
          filesystem: fs.fs,
          mount_point: fs.mount,
          type: fs.type,
          total_gb: totalGb.toFixed(2),
          used_gb: usedGb.toFixed(2),
        };
        await this.publishAttributes(`${this.featureName}/${objectId}/attributes`, attributes, true);
      }
    } catch (error) {
      logger.error(`Error updating disk usage for ${this.featureName}:`, error);
    }
  }
}
