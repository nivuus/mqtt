// src/utils/diskStats.ts
import * as fs from 'fs/promises';
import logger from './logger';

const SECTOR_SIZE = 512; // Standard sector size in bytes

export interface DiskIOStats {
  device: string;
  rIO: number; // Total bytes read
  wIO: number; // Total bytes written
}

/**
 * Reads and parses /proc/diskstats to get I/O statistics for block devices.
 * @returns A promise that resolves to an array of DiskIOStats.
 */
export async function getNativeDiskIOStats(): Promise<DiskIOStats[]> {
  const stats: DiskIOStats[] = [];
  try {
    const data = await fs.readFile('/proc/diskstats', 'utf-8');
    const lines = data.trim().split('\n');

    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 14) {
        continue; // Not a valid diskstats line
      }

      // Field indices (0-based) from man iostat / kernel documentation:
      // 2: device name
      // 5: sectors read
      // 9: sectors written
      const deviceName = fields[2];
      const sectorsRead = parseInt(fields[5], 10);
      const sectorsWritten = parseInt(fields[9], 10);

      if (deviceName && !isNaN(sectorsRead) && !isNaN(sectorsWritten)) {
        // We are interested in whole devices (e.g., sda, nvme0n1)
        // not partitions (e.g., sda1, nvme0n1p1) for overall disk speed.
        // /proc/diskstats includes both. We'll let the calling function filter.
        stats.push({
          device: deviceName,
          rIO: sectorsRead * SECTOR_SIZE,
          wIO: sectorsWritten * SECTOR_SIZE,
        });
      }
    }
  } catch (error) {
    logger.error('[diskStats] Error reading or parsing /proc/diskstats:', error);
    // Return empty array or throw, depending on desired error handling.
    // For now, returning empty allows the calling feature to handle no data.
    return [];
  }
  return stats;
}
