// src/features/network/BridgeStatsReader.ts

import { promises as fs } from 'fs';
import logger from '../../utils/logger';

export interface BridgeNetworkStats {
  iface: string;
  rx_bytes: number;
  tx_bytes: number;
}

export class BridgeStatsReader {
  
  /**
   * Read network statistics directly from /proc/net/dev for bridge interfaces
   * This is used as a fallback when systeminformation fails to get bridge stats
   */
  static async readBridgeStats(interfaceNames: string[]): Promise<BridgeNetworkStats[]> {
    try {
      const procNetDevContent = await fs.readFile('/proc/net/dev', 'utf8');
      const lines = procNetDevContent.split('\n');
      
      // Skip header lines (first 2 lines)
      const dataLines = lines.slice(2);
      
      const results: BridgeNetworkStats[] = [];
      
      for (const interfaceName of interfaceNames) {
        // Find interface with case-insensitive search
        const line = dataLines.find(line => {
          const lineParts = line.trim().split(':');
          if (lineParts.length < 2) return false;
          const actualInterfaceName = lineParts[0].trim();
          return actualInterfaceName.toLowerCase() === interfaceName.toLowerCase();
        });
        
        if (line) {
          const stats = this.parseProcNetDevLine(line, interfaceName);
          if (stats) {
            results.push(stats);
            logger.debug(`[BridgeStatsReader] Found stats for ${interfaceName}: rx=${stats.rx_bytes}, tx=${stats.tx_bytes}`);
          }
        } else {
          logger.warn(`[BridgeStatsReader] No data found in /proc/net/dev for interface: ${interfaceName}`);
        }
      }
      
      return results;
    } catch (error) {
      logger.error('[BridgeStatsReader] Error reading /proc/net/dev:', error);
      return [];
    }
  }
  
  private static parseProcNetDevLine(line: string, expectedInterface: string): BridgeNetworkStats | null {
    try {
      // Format: interface: bytes packets errs drop fifo frame compressed multicast
      const parts = line.trim().split(/\s+/);
      
      if (parts.length < 17) {
        logger.warn(`[BridgeStatsReader] Invalid line format for ${expectedInterface}: ${line}`);
        return null;
      }
      
      // Remove the colon from interface name
      const interfaceName = parts[0].replace(':', '');
      
      // No need to check interface name mismatch since we already found it with case-insensitive search
      
      // Receive stats start at index 1, transmit stats start at index 9
      const rxBytes = parseInt(parts[1], 10);
      const txBytes = parseInt(parts[9], 10);
      
      if (isNaN(rxBytes) || isNaN(txBytes)) {
        logger.warn(`[BridgeStatsReader] Invalid byte values for ${interfaceName}: rx=${parts[1]}, tx=${parts[9]}`);
        return null;
      }
      
      return {
        iface: interfaceName, // Return the actual interface name as found in /proc/net/dev
        rx_bytes: rxBytes,
        tx_bytes: txBytes
      };
    } catch (error) {
      logger.error(`[BridgeStatsReader] Error parsing line for ${expectedInterface}:`, error);
      return null;
    }
  }
}
