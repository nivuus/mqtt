// src/features/disk/WindowsDiskUsage.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { createWinRMClient, WinRMClient } from '../../utils/winrm';
import { isWindowsVmRunning } from '../../utils/vmState';
import logger from '../../utils/logger';

interface WindowsDiskConfig extends FeatureConfig {
  volumes?: string[]; // e.g., ["C:", "D:"] - if empty, auto-detect all fixed drives
}

interface VolumeInfo {
  DriveLetter: string;
  FileSystemLabel: string;
  FileSystem: string;
  SizeGB: number;
  UsedGB: number;
  FreeGB: number;
  UsagePercent: number;
}

interface DiskIOSnapshot {
  readBytesPerSec: number;
  writeBytesPerSec: number;
  timestamp: number;
}

export class WindowsDiskUsage extends BaseFeature {
  protected featureConfig: WindowsDiskConfig;
  private winrmClient: WinRMClient;
  private previousDiskStats: { [diskName: string]: DiskIOSnapshot } = {};

  constructor(mqttClient: MqttClient, featureName: string = 'windows_disk_usage') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as WindowsDiskConfig ||
                         { enabled: true, update_interval_seconds: 60 };
    this.winrmClient = createWinRMClient();
  }

  /**
   * Encode PowerShell script to Base64 UTF-16LE for -EncodedCommand
   */
  private encodePowerShellCommand(script: string): string {
    const utf16le = Buffer.from(script, 'utf16le').toString('base64');
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${utf16le}`;
  }

  /**
   * Query Windows volume information via WinRM
   */
  private async getVolumeInfo(): Promise<VolumeInfo[]> {
    try {
      // PowerShell script to get volume information
      const psScript = `$ProgressPreference='SilentlyContinue'; Get-Volume | Where-Object {$_.DriveType -eq 'Fixed' -and $_.DriveLetter} | Select-Object @{N='DriveLetter';E={$_.DriveLetter+':'}},FileSystemLabel,FileSystem,@{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}},@{N='UsedGB';E={[math]::Round(($_.Size-$_.SizeRemaining)/1GB,2)}},@{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}},@{N='UsagePercent';E={if($_.Size -gt 0){[math]::Round((1-$_.SizeRemaining/$_.Size)*100,1)}else{0}}} | ConvertTo-Json -Compress`;

      const command = this.encodePowerShellCommand(psScript);
      const result = await this.winrmClient.executeCommand(command);

      if (!result || result.trim() === '') {
        logger.warn(`[${this.featureName}] Empty response from Get-Volume command`);
        return [];
      }

      // Clean the output - remove BOM and trim
      const cleanResult = result.replace(/^\uFEFF/, '').trim();

      logger.debug(`[${this.featureName}] Raw volume output (first 200 chars): ${cleanResult.substring(0, 200)}`);

      // Parse JSON response
      const parsed = JSON.parse(cleanResult);
      const volumes = Array.isArray(parsed) ? parsed : [parsed];

      // Filter by configured volumes if specified
      if (this.featureConfig.volumes && this.featureConfig.volumes.length > 0) {
        return volumes.filter(v => this.featureConfig.volumes!.includes(v.DriveLetter));
      }

      return volumes;
    } catch (error) {
      logger.error(`[${this.featureName}] Error getting volume info:`, error);
      return [];
    }
  }

  /**
   * Query disk I/O performance counters via WinRM
   */
  private async getDiskIOStats(): Promise<{ [diskName: string]: DiskIOSnapshot }> {
    try {
      // Use WMI Win32_PerfFormattedData_PerfDisk_PhysicalDisk for language-independent disk I/O stats
      const psScript = `$ProgressPreference='SilentlyContinue'; Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object {$_.Name -ne '_Total'} | Select-Object Name,@{N='ReadBytesPerSec';E={$_.DiskReadBytesPersec}},@{N='WriteBytesPerSec';E={$_.DiskWriteBytesPersec}} | ConvertTo-Json -Compress`;

      const command = this.encodePowerShellCommand(psScript);
      const result = await this.winrmClient.executeCommand(command);

      if (!result || result.trim() === '') {
        logger.warn(`[${this.featureName}] Empty response from Get-Counter command`);
        return {};
      }

      // Clean the output - remove BOM and trim
      const cleanResult = result.replace(/^\uFEFF/, '').trim();

      logger.info(`[${this.featureName}] Raw IO output: ${cleanResult}`);

      const parsed = JSON.parse(cleanResult);
      const disks = Array.isArray(parsed) ? parsed : [parsed];
      logger.info(`[${this.featureName}] Parsed ${disks.length} physical disk(s)`);

      const stats: { [diskName: string]: DiskIOSnapshot } = {};
      const timestamp = Date.now();

      // Parse WMI disk performance data
      // Format: { Name: "0 C:", ReadBytesPerSec: 123, WriteBytesPerSec: 456 }
      for (const disk of disks) {
        if (!disk.Name) continue;

        stats[disk.Name] = {
          readBytesPerSec: disk.ReadBytesPerSec || 0,
          writeBytesPerSec: disk.WriteBytesPerSec || 0,
          timestamp
        };

        logger.info(`[${this.featureName}] Disk ${disk.Name}: Read=${disk.ReadBytesPerSec}, Write=${disk.WriteBytesPerSec}`);
      }

      return stats;
    } catch (error) {
      logger.error(`[${this.featureName}] Error getting disk I/O stats:`, error);
      return {};
    }
  }

  /**
   * Convert drive letter to safe entity ID suffix (C: -> c)
   */
  private driveLetterToEntityId(driveLetter: string): string {
    return driveLetter.replace(':', '').toLowerCase();
  }

  /**
   * Publish Home Assistant discovery for all volume sensors
   */
  protected async publishDiscovery(): Promise<void> {
    try {
      const volumes = await this.getVolumeInfo();

      for (const volume of volumes) {
        const entityIdSuffix = this.driveLetterToEntityId(volume.DriveLetter);

        // Usage Percentage Sensor
        await this.publishEntityDiscovery('sensor', `windows_disk_${entityIdSuffix}_usage_percent`, {
          name: `Disk Windows ${volume.DriveLetter} Usage`,
          state_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/usage_percent/state`,
          unit_of_measurement: '%',
          state_class: 'measurement' as 'measurement',
          icon: 'mdi:harddisk',
          entity_category: 'diagnostic' as 'diagnostic',
          json_attributes_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/attributes`
        });

        // Available Space Sensor
        await this.publishEntityDiscovery('sensor', `windows_disk_${entityIdSuffix}_available_gb`, {
          name: `Disk Windows ${volume.DriveLetter} Available`,
          state_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/available_gb/state`,
          unit_of_measurement: 'GB',
          state_class: 'measurement' as 'measurement',
          icon: 'mdi:harddisk',
          device_class: 'data_size' as 'data_size',
          entity_category: 'diagnostic' as 'diagnostic'
        });

        // Total Space Sensor
        await this.publishEntityDiscovery('sensor', `windows_disk_${entityIdSuffix}_total_gb`, {
          name: `Disk Windows ${volume.DriveLetter} Total`,
          state_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/total_gb/state`,
          unit_of_measurement: 'GB',
          state_class: 'measurement' as 'measurement',
          icon: 'mdi:harddisk',
          device_class: 'data_size' as 'data_size',
          entity_category: 'diagnostic' as 'diagnostic'
        });

        // Read Speed Sensor
        await this.publishEntityDiscovery('sensor', `windows_disk_${entityIdSuffix}_read_speed`, {
          name: `Disk Windows ${volume.DriveLetter} Read Speed`,
          state_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/read_speed/state`,
          unit_of_measurement: 'MB/s',
          state_class: 'measurement' as 'measurement',
          icon: 'mdi:download',
          device_class: 'data_rate' as 'data_rate',
          entity_category: 'diagnostic' as 'diagnostic'
        });

        // Write Speed Sensor
        await this.publishEntityDiscovery('sensor', `windows_disk_${entityIdSuffix}_write_speed`, {
          name: `Disk Windows ${volume.DriveLetter} Write Speed`,
          state_topic: `${this.featureName}/windows_disk_${entityIdSuffix}/write_speed/state`,
          unit_of_measurement: 'MB/s',
          state_class: 'measurement' as 'measurement',
          icon: 'mdi:upload',
          device_class: 'data_rate' as 'data_rate',
          entity_category: 'diagnostic' as 'diagnostic'
        });

        logger.info(`[${this.featureName}] Published discovery for Windows disk ${volume.DriveLetter}`);
      }
    } catch (error) {
      logger.error(`[${this.featureName}] Error publishing discovery:`, error);
    }
  }

  /**
   * Update volume and I/O stats
   */
  protected async update(): Promise<void> {
    if (!await isWindowsVmRunning()) {
      logger.debug(`[${this.featureName}] Windows VM not running, skipping`);
      return;
    }
    try {
      logger.info(`[${this.featureName}] Starting update cycle...`);

      // Get volume space information
      const volumes = await this.getVolumeInfo();
      logger.info(`[${this.featureName}] Retrieved ${volumes.length} volume(s)`);

      for (const volume of volumes) {
        const entityIdSuffix = this.driveLetterToEntityId(volume.DriveLetter);
        logger.info(`[${this.featureName}] Publishing metrics for ${volume.DriveLetter} (entity suffix: ${entityIdSuffix})`);

        // Publish space metrics
        await this.publishState(`${this.featureName}/windows_disk_${entityIdSuffix}/usage_percent/state`, volume.UsagePercent.toString());
        await this.publishState(`${this.featureName}/windows_disk_${entityIdSuffix}/available_gb/state`, volume.FreeGB.toFixed(2));
        await this.publishState(`${this.featureName}/windows_disk_${entityIdSuffix}/total_gb/state`, volume.SizeGB.toFixed(2));
        logger.info(`[${this.featureName}] Published space metrics for ${volume.DriveLetter}: ${volume.UsagePercent}%, ${volume.FreeGB}GB free of ${volume.SizeGB}GB`);

        // Publish attributes
        await this.publishAttributes(`${this.featureName}/windows_disk_${entityIdSuffix}/attributes`, {
          volume_label: volume.FileSystemLabel,
          filesystem: volume.FileSystem,
          drive_letter: volume.DriveLetter,
          used_gb: volume.UsedGB.toFixed(2),
          free_gb: volume.FreeGB.toFixed(2),
          total_gb: volume.SizeGB.toFixed(2)
        });

        logger.debug(`[${this.featureName}] Published space metrics for ${volume.DriveLetter}`);
      }

      // Get disk I/O performance
      const currentStats = await this.getDiskIOStats();
      logger.info(`[${this.featureName}] Retrieved ${Object.keys(currentStats).length} disk I/O stat(s)`);

      for (const [diskName, currentIO] of Object.entries(currentStats)) {
        // Try to match disk name to drive letter (e.g., "0 C:" -> C:)
        logger.info(`[${this.featureName}] Processing disk I/O for: ${diskName}`);
        const match = diskName.match(/\d+\s+([A-Z]:)/);
        if (!match) {
          logger.info(`[${this.featureName}] No drive letter match for disk: ${diskName}`);
          continue;
        }

        const driveLetter = match[1];
        const entityIdSuffix = this.driveLetterToEntityId(driveLetter);
        logger.info(`[${this.featureName}] Publishing I/O metrics for ${driveLetter}`);

        // Calculate speeds in MB/s
        const readSpeedMBps = currentIO.readBytesPerSec / (1024 * 1024);
        const writeSpeedMBps = currentIO.writeBytesPerSec / (1024 * 1024);

        await this.publishState(`${this.featureName}/windows_disk_${entityIdSuffix}/read_speed/state`, readSpeedMBps.toFixed(2));
        await this.publishState(`${this.featureName}/windows_disk_${entityIdSuffix}/write_speed/state`, writeSpeedMBps.toFixed(2));

        // Store for next iteration (currently not used for delta calculation as Get-Counter returns rate)
        this.previousDiskStats[diskName] = currentIO;
      }

      logger.debug(`[${this.featureName}] Updated ${volumes.length} Windows disk volumes`);
    } catch (error) {
      logger.error(`[${this.featureName}] Error in update:`, error);
    }
  }

  async setup(): Promise<void> {
    try {
      // Test WinRM connectivity
      const volumes = await this.getVolumeInfo();
      if (volumes.length === 0) {
        logger.warn(`[${this.featureName}] No Windows volumes detected - check WinRM connection`);
      } else {
        logger.info(`[${this.featureName}] Successfully connected to Windows VM - detected ${volumes.length} volume(s)`);
      }
    } catch (error) {
      logger.error(`[${this.featureName}] Setup failed - WinRM connection issue:`, error);
    }
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
    this.previousDiskStats = {};
  }

  protected async setupCommandHandlers(): Promise<void> {
    // No command handlers needed for disk monitoring
  }
}
