// src/features/disk/SmartStatus.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { execute_argv } from '../../utils/exec';
import * as si from 'systeminformation'; // Keep for si.blockDevices if still used by getMonitoredDisks and potentially for SiDisksIoData type if needed elsewhere
import logger from '../../utils/logger';
import { getNativeDiskIOStats, DiskIOStats as NativeDiskIOStats } from '../../utils/diskStats';
import { createWinRMClient } from '../../utils/winrm';
import { isWindowsVmRunning } from '../../utils/vmState';
import { toObjectId } from '../../homeassistant/discovery/discoveryTopic';
import {
  dataTotalsGb, isNvmeReport, parseSmartAttributes, parseSmartOverallHealth, toPublishedAttributes,
} from './smartctlReport';

interface RemoteDiskConfig {
  name: string;
  device: string;
  friendly_name: string;
}

interface SmartStatusFeatureConfig extends FeatureConfig {
  disks_to_monitor?: string[]; // e.g., ["sda", "sdb", "nvme0n1"]
  remote_disks?: RemoteDiskConfig[]; // Remote disks via WinRM
}

export class SmartStatus extends BaseFeature {
  protected featureConfig: SmartStatusFeatureConfig;
  private previousBlockStats: { [diskName: string]: NativeDiskIOStats } = {};
  private winrmClient = createWinRMClient();

  constructor(mqttClient: MqttClient, featureName: string = 'smart_status') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as SmartStatusFeatureConfig ||
                         { enabled: true, update_interval_seconds: 3600 };
  }

  private async getMonitoredDisks(): Promise<string[]> {
    if (this.featureConfig.disks_to_monitor && this.featureConfig.disks_to_monitor.length > 0) {
      return this.featureConfig.disks_to_monitor;
    }
    // Auto-detect physical disks
    try {
      const blockDevices = await si.blockDevices();
      logger.debug(`[${this.featureName}] Raw block devices detected:`, JSON.stringify(blockDevices, null, 2));
      // Filter for actual disks, not partitions or virtual devices like loop/ram
      const filteredDisks = blockDevices
        .filter(dev => {
          const isDisk = dev.type === 'disk';
          const isNotLoop = !dev.name.startsWith('loop');
          const isNotRam = !dev.name.startsWith('ram');
          const passesFilter = isDisk && isNotLoop && isNotRam;
          if (!passesFilter) {
            logger.debug(`[${this.featureName}] Disk ${dev.name} (type: ${dev.type}) filtered out. IsDisk: ${isDisk}, IsNotLoop: ${isNotLoop}, IsNotRam: ${isNotRam}`);
          }
          return passesFilter;
        })
        .map(dev => dev.name);
      logger.debug(`[${this.featureName}] Filtered physical disks for monitoring:`, JSON.stringify(filteredDisks, null, 2));
      return filteredDisks;
    } catch (error) {
      logger.error(`Error auto-detecting disks for ${this.featureName}:`, error);
      return [];
    }
  }

  protected async publishDiscovery(): Promise<void> {
    const disks = await this.getMonitoredDisks();
    for (const diskName of disks) {
      const objectId = toObjectId(diskName);
      const baseName = `Disk ${diskName}`;

      // SMART Health Status Sensor
      await this.publishEntityDiscovery('sensor', `${objectId}_smart_health`, {
        name: `${baseName} SMART Health`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/health/state`),
        icon: 'mdi:heart-pulse',
        entity_category: 'diagnostic' as 'diagnostic',
        json_attributes_topic: this.prefixTopic(`${this.featureName}/${objectId}/attributes`),
      });

      // Disk Read Speed
      await this.publishEntityDiscovery('sensor', `${objectId}_read_speed`, {
        name: `${baseName} Read Speed`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/read_speed/state`),
        unit_of_measurement: 'MB/s',
        icon: 'mdi:arrow-down-box',
        state_class: 'measurement' as 'measurement',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      // Disk Write Speed
      await this.publishEntityDiscovery('sensor', `${objectId}_write_speed`, {
        name: `${baseName} Write Speed`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/write_speed/state`),
        unit_of_measurement: 'MB/s',
        icon: 'mdi:arrow-up-box',
        state_class: 'measurement' as 'measurement',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      // Total LBAs Written
      await this.publishEntityDiscovery('sensor', `${objectId}_lbas_written`, {
        name: `${baseName} Total Data Written`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/lbas_written/state`),
        unit_of_measurement: 'GB', // Or TB, will convert in update
        icon: 'mdi:database-arrow-down-outline',
        state_class: 'total_increasing' as 'total_increasing',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      // Total LBAs Read
      await this.publishEntityDiscovery('sensor', `${objectId}_lbas_read`, {
        name: `${baseName} Total Data Read`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/lbas_read/state`),
        unit_of_measurement: 'GB', // Or TB
        icon: 'mdi:database-arrow-up-outline',
        state_class: 'total_increasing' as 'total_increasing',
        entity_category: 'diagnostic' as 'diagnostic',
      });
    }

    // Publish discovery for remote disks (Windows VM via WinRM)
    const remoteDisks = this.featureConfig.remote_disks || [];
    for (const remoteDisk of remoteDisks) {
      const objectId = toObjectId(remoteDisk.name);
      const baseName = `Disk ${remoteDisk.friendly_name}`;

      // SMART Health Status Sensor
      await this.publishEntityDiscovery('sensor', `${objectId}_smart_health`, {
        name: `${baseName} SMART Health`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/health/state`),
        icon: 'mdi:heart-pulse',
        entity_category: 'diagnostic' as 'diagnostic',
        json_attributes_topic: this.prefixTopic(`${this.featureName}/${objectId}/attributes`),
      });

      // Total Data Written
      await this.publishEntityDiscovery('sensor', `${objectId}_lbas_written`, {
        name: `${baseName} Total Data Written`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/lbas_written/state`),
        unit_of_measurement: 'GB',
        icon: 'mdi:database-arrow-down-outline',
        state_class: 'total_increasing' as 'total_increasing',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      // Total Data Read
      await this.publishEntityDiscovery('sensor', `${objectId}_lbas_read`, {
        name: `${baseName} Total Data Read`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/lbas_read/state`),
        unit_of_measurement: 'GB',
        icon: 'mdi:database-arrow-up-outline',
        state_class: 'total_increasing' as 'total_increasing',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      // Note: No read/write speed sensors for remote disks since we can't monitor I/O stats remotely
    }
  }

  protected async update(): Promise<void> {
    const disks = await this.getMonitoredDisks();
    const nativeDiskIOData = await getNativeDiskIOStats();
    const currentDiskIOArray: NativeDiskIOStats[] = Array.isArray(nativeDiskIOData) ? nativeDiskIOData : [];
    logger.info(`[${this.featureName}] Raw disk I/O data from getNativeDiskIOStats():`, JSON.stringify(currentDiskIOArray, null, 2)); // TEMPORARY LOG

    for (const diskName of disks) {
      await this.updateLocalDisk(diskName, currentDiskIOArray);
    }

    // Process remote disks (Windows VM via WinRM) - only if VM is running
    const remoteDisks = this.featureConfig.remote_disks || [];
    if (remoteDisks.length > 0 && !await isWindowsVmRunning()) {
      logger.debug(`[${this.featureName}] Windows VM not running, skipping remote disks`);
      return;
    }
    for (const remoteDisk of remoteDisks) {
      await this.updateRemoteDisk(remoteDisk);
    }
  }

  private async updateLocalDisk(diskName: string, currentDiskIOArray: NativeDiskIOStats[]): Promise<void> {
    const objectId = toObjectId(diskName);
    logger.debug(`[${this.featureName}] Processing disk: ${diskName}, objectId: ${objectId}`);
    try {
      // Get all SMART data in JSON format (requires sudo)
      const smartctlOutput = await execute_argv('sudo', ['smartctl', '-j', '-a', `/dev/${diskName}`]);
      logger.debug(`[${this.featureName}] SMART JSON output for /dev/${diskName}:`, smartctlOutput.stdout);

      if (!smartctlOutput.stdout || smartctlOutput.stdout.trim() === '') {
        logger.error(`[${this.featureName}] smartctl returned empty stdout for ${diskName}. ExitCode: ${smartctlOutput.exitCode}, Stderr: ${smartctlOutput.stderr}`);
        await this.publishDiskError(objectId, 'ERROR_NO_OUTPUT', {
          error: 'smartctl returned no output',
          exitCode: smartctlOutput.exitCode,
          stderr: smartctlOutput.stderr
        });
        return;
      }

      let jsonData;
      try {
        jsonData = JSON.parse(smartctlOutput.stdout);
      } catch (parseError) {
        logger.error(`[${this.featureName}] Failed to parse SMART JSON for /dev/${diskName}:`, parseError);
        logger.error(`[${this.featureName}] Raw stdout was:`, smartctlOutput.stdout);
        logger.error(`[${this.featureName}] Raw stderr was:`, smartctlOutput.stderr);
        await this.publishDiskError(objectId, 'ERROR_PARSING_JSON', {
          error: 'Failed to parse smartctl JSON output',
          parseError: String(parseError),
          stdoutPreview: smartctlOutput.stdout.substring(0, 200)
        });
        return;
      }

      await this.publishSmartReport(objectId, jsonData, diskName.startsWith('nvme') || isNvmeReport(jsonData));
      await this.publishIoSpeeds(diskName, objectId, currentDiskIOArray);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`Error updating SMART status for disk ${diskName} (${this.featureName}):`, errorMessage);
      await this.publishDiskError(objectId, 'ERROR', { error: errorMessage });
    }
  }

  private async updateRemoteDisk(remoteDisk: RemoteDiskConfig): Promise<void> {
    const objectId = toObjectId(remoteDisk.name);
    logger.debug(`[${this.featureName}] Processing remote disk: ${remoteDisk.name}, device: ${remoteDisk.device}`);
    try {
      const smartctlOutput = await this.winrmClient.executeCommand(`smartctl -j -a ${remoteDisk.device}`);

      if (!smartctlOutput || smartctlOutput.trim() === '') {
        logger.error(`[${this.featureName}] WinRM smartctl returned empty output for ${remoteDisk.name}`);
        await this.publishDiskError(objectId, 'ERROR_NO_OUTPUT', { error: 'smartctl returned no output via WinRM' });
        return;
      }

      let jsonData;
      try {
        jsonData = JSON.parse(smartctlOutput);
      } catch (parseError) {
        logger.error(`[${this.featureName}] Failed to parse SMART JSON for remote ${remoteDisk.name}:`, parseError);
        await this.publishDiskError(objectId, 'ERROR_PARSING_JSON', {
          error: 'Failed to parse smartctl JSON output',
          parseError: String(parseError)
        });
        return;
      }

      // Disk I/O speed is not available for remote disks: SMART only.
      await this.publishSmartReport(objectId, jsonData, isNvmeReport(jsonData));
      logger.debug(`[${this.featureName}] Remote disk ${remoteDisk.name} processed successfully`);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      logger.error(`Error updating SMART status for remote disk ${remoteDisk.name} (${this.featureName}):`, errorMessage);
      await this.publishDiskError(objectId, 'ERROR', { error: errorMessage });
    }
  }

  /** Health, attribute list and data totals of one disk, local or remote. */
  private async publishSmartReport(objectId: string, jsonData: any, isNvme: boolean): Promise<void> {
    await this.publishState(`${this.featureName}/${objectId}/health/state`, parseSmartOverallHealth(jsonData), true);
    const attributes = parseSmartAttributes(jsonData, isNvme);
    await this.publishAttributes(`${this.featureName}/${objectId}/attributes`, { smart_attributes: toPublishedAttributes(attributes) }, true);
    const totals = dataTotalsGb(attributes);
    if (totals.written !== undefined) {
      await this.publishState(`${this.featureName}/${objectId}/lbas_written/state`, totals.written.toFixed(2), true);
    }
    if (totals.read !== undefined) {
      await this.publishState(`${this.featureName}/${objectId}/lbas_read/state`, totals.read.toFixed(2), true);
    }
  }

  private async publishDiskError(objectId: string, state: string, attributes: object): Promise<void> {
    await this.publishState(`${this.featureName}/${objectId}/health/state`, state, true);
    await this.publishAttributes(`${this.featureName}/${objectId}/attributes`, attributes, true);
  }

  /** Read and write speeds since the previous sample (0 on the first one). */
  private async publishIoSpeeds(diskName: string, objectId: string, currentDiskIOArray: NativeDiskIOStats[]): Promise<void> {
    const ioStat = currentDiskIOArray.find(stat => stat.device === diskName || stat.device === `/dev/${diskName}`);
    const prevIoStat = this.previousBlockStats[diskName];
    if (!ioStat) {
      logger.warn(`[${this.featureName}] Disk I/O for ${diskName}: Could not find matching I/O statistics. Raw data logged earlier.`);
    }

    const interval = this.featureConfig.update_interval_seconds;
    if (ioStat && interval) {
      // No previous data on the first run: speeds are 0.
      // Counters that reset or roll over never give a negative speed.
      const readSpeed = prevIoStat ? Math.max(0, ioStat.rIO - prevIoStat.rIO) / interval : 0; // Bytes per second
      const writeSpeed = prevIoStat ? Math.max(0, ioStat.wIO - prevIoStat.wIO) / interval : 0;
      await this.publishState(`${this.featureName}/${objectId}/read_speed/state`, (readSpeed / (1024 * 1024)).toFixed(2), true);
      await this.publishState(`${this.featureName}/${objectId}/write_speed/state`, (writeSpeed / (1024 * 1024)).toFixed(2), true);
    } else {
      logger.warn(`[${this.featureName}] Disk I/O for ${diskName}: Skipped speed calculation. ioStat valid: ${!!ioStat}, update_interval_seconds: ${interval}`);
    }
    if (ioStat) {
      this.previousBlockStats[diskName] = { ...ioStat }; // Store a copy
    }
  }
}
