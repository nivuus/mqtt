// src/features/network/NetworkStats.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import * as si from 'systeminformation';
import logger from '../../utils/logger';
import { BridgeStatsReader } from './BridgeStatsReader';

interface NetworkStatsFeatureConfig extends FeatureConfig {
  interfaces?: string[]; 
  ignored_interfaces_regex?: string[];
}

export class NetworkStats extends BaseFeature {
  private previousNetStats: { [iface: string]: si.Systeminformation.NetworkStatsData } = {};
  
  private readonly defaultIgnoredInterfacePatterns: RegExp[] = [
    /^lo$/i,
    /^docker0$/i,
    /^veth/i, // Filter ALL interfaces starting with "veth" (Docker virtual ethernet)
    /^br-[0-9a-f]{12}$/i, // Docker-style bridges (br- followed by exactly 12 hex chars)
    /^hassio$/i,
    /^virbr[0-9]+/i,
    /^vboxnet[0-9]+/i,
    /^vmnet[0-9]+/i,
  ];
  protected featureConfig: NetworkStatsFeatureConfig;

  constructor(mqttClient: MqttClient, featureName: string = 'network_stats') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as NetworkStatsFeatureConfig || 
                         { enabled: true, update_interval_seconds: 15 };
  }

  private isMonitoredType(ifaceType: string | undefined): boolean {
    if (!ifaceType) return false;
    const monitoredTypes = ['wired', 'wireless', 'ppp', 'bridge', 'vlan', 'bond'];
    return monitoredTypes.includes(ifaceType.toLowerCase());
  }

  private isPppInterface(ifaceName: string, ifaceType: string | undefined): boolean {
    // PPP interfaces often have type "unknown" but start with "ppp"
    return ifaceName.toLowerCase().startsWith('ppp') || ifaceType?.toLowerCase() === 'ppp';
  }

  private isBridgeInterface(ifaceName: string, ifaceType: string | undefined): boolean {
    // Bridge interfaces can have type "bridge", "unknown", or contain "bridge" in name
    return ifaceType?.toLowerCase() === 'bridge' || 
           (ifaceType?.toLowerCase() === 'unknown' && ifaceName.toLowerCase().includes('bridge'));
  }

  private async getRelevantInterfaces(): Promise<si.Systeminformation.NetworkInterfacesData[]> {
    const allInterfaces = await si.networkInterfaces();
    logger.debug(`[${this.featureName}] ALL network interfaces from systeminformation:`, JSON.stringify(allInterfaces, null, 2));
    const interfacesArray = Array.isArray(allInterfaces) ? allInterfaces : [allInterfaces];

    if (this.featureConfig.interfaces && this.featureConfig.interfaces.length > 0) {
      logger.debug(`[${this.featureName}] Using manually specified interfaces:`, this.featureConfig.interfaces);
      return interfacesArray.filter(iface => iface.iface && this.featureConfig.interfaces!.includes(iface.iface));
    }

    const ignoredPatterns = (this.featureConfig.ignored_interfaces_regex 
      ? this.featureConfig.ignored_interfaces_regex.map(p => new RegExp(p, 'i')) 
      : this.defaultIgnoredInterfacePatterns);
    
    logger.debug(`[${this.featureName}] Using ignored interface patterns:`, ignoredPatterns.map(p => p.toString()));

    const filteredInterfaces = interfacesArray.filter(ifaceData => {
      if (!ifaceData.iface || !ifaceData.type) {
        logger.debug(`[${this.featureName}] Interface skipped (no name or type):`, JSON.stringify(ifaceData));
        return false;
      }
      if (ifaceData.internal) {
        logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) skipped: internal.`);
        return false;
      }
      
      const typeIsMonitored = this.isMonitoredType(ifaceData.type);
      const isExplicitBridgeType = ifaceData.type.toLowerCase() === 'bridge';
      const isPotentiallyBridgeByName = this.isBridgeInterface(ifaceData.iface, ifaceData.type);
      const isPppInterface = this.isPppInterface(ifaceData.iface, ifaceData.type);

      logger.debug(`[${this.featureName}] Evaluating interface ${ifaceData.iface}: type=${ifaceData.type}, typeIsMonitored=${typeIsMonitored}, isExplicitBridgeType=${isExplicitBridgeType}, isPotentiallyBridgeByName=${isPotentiallyBridgeByName}, isPppInterface=${isPppInterface}`);

      if (!typeIsMonitored && !isPotentiallyBridgeByName && !isPppInterface) {
         logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) skipped: not a monitored type, not a bridge, and not a PPP interface.`);
        return false;
      }

      // Check against ignore patterns
      for (const pattern of ignoredPatterns) {
        if (pattern.test(ifaceData.iface)) {
          // Special handling for bridges: only ignore Docker-style bridges, not system bridges
          if (isExplicitBridgeType && pattern.toString().includes('br-[0-9a-f]{12}')) {
            // This is the Docker bridge pattern - only ignore if it matches Docker naming exactly
            if (/^br-[0-9a-f]{12}$/i.test(ifaceData.iface)) {
              logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) ignored: Docker bridge.`);
              return false;
            }
            // If it's a bridge but doesn't match Docker pattern, don't ignore it
            logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) is a system bridge, not Docker - will monitor.`);
            continue;
          } else {
            logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) ignored due to pattern: ${pattern}`);
            return false;
          }
        }
      }
      logger.debug(`[${this.featureName}] Interface ${ifaceData.iface} (type: ${ifaceData.type}) is relevant for monitoring.`);
      return true;
    });

    logger.debug(`[${this.featureName}] Final filtered interfaces:`, filteredInterfaces.map(i => `${i.iface}(${i.type})`));
    return filteredInterfaces;
  }

  protected async publishDiscovery(): Promise<void> {
    const discoveryPromises: Promise<void>[] = [];
    try {
      const relevantInterfaces = await this.getRelevantInterfaces();
      
      for (const ifaceData of relevantInterfaces) {
        const ifaceName = ifaceData.iface;
        const friendlyName = `Network ${ifaceName}`;

        const commonSensorConfig = {
          entity_category: 'diagnostic' as 'diagnostic',
        };

        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${ifaceName}_upload_speed`, {
          ...commonSensorConfig, name: `${friendlyName} Upload Speed`,
          state_topic: this.prefixTopic(`${this.featureName}/${ifaceName}/upload_speed/state`),
          unit_of_measurement: 'Mbps', icon: 'mdi:upload-network',
          state_class: 'measurement' as 'measurement',
        }));
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${ifaceName}_download_speed`, {
          ...commonSensorConfig, name: `${friendlyName} Download Speed`,
          state_topic: this.prefixTopic(`${this.featureName}/${ifaceName}/download_speed/state`),
          unit_of_measurement: 'Mbps', icon: 'mdi:download-network',
          state_class: 'measurement' as 'measurement',
        }));
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${ifaceName}_total_uploaded`, {
          ...commonSensorConfig, name: `${friendlyName} Total Uploaded`,
          state_topic: this.prefixTopic(`${this.featureName}/${ifaceName}/total_uploaded/state`),
          unit_of_measurement: 'GB', icon: 'mdi:chart-bar',
          state_class: 'total_increasing' as 'total_increasing',
        }));
        discoveryPromises.push(this.publishEntityDiscovery('sensor', `${ifaceName}_total_downloaded`, {
          ...commonSensorConfig, name: `${friendlyName} Total Downloaded`,
          state_topic: this.prefixTopic(`${this.featureName}/${ifaceName}/total_downloaded/state`),
          unit_of_measurement: 'GB', icon: 'mdi:chart-bar',
          state_class: 'total_increasing' as 'total_increasing',
        }));

        // Initialize states to 0.00 or fetch initial stats
        await this.publishState(`${this.featureName}/${ifaceName}/download_speed/state`, '0.00', true);
        await this.publishState(`${this.featureName}/${ifaceName}/upload_speed/state`, '0.00', true);
        
        try {
            const initialStatsResult = await si.networkStats(ifaceName);
            let initialStats = Array.isArray(initialStatsResult) ? initialStatsResult[0] : initialStatsResult;
            
            // Handle bridge interfaces that may have null rx_sec/tx_sec from systeminformation
            if (this.isBridgeInterface(ifaceName, ifaceData.type)) {
              // For bridge interfaces, ensure we have valid byte counters even if speed data is null
              if (initialStats && initialStats.rx_bytes !== null && initialStats.tx_bytes !== null) {
                // Systeminformation provided byte counters, use them but normalize null speed values
                if (initialStats.rx_sec === null) initialStats.rx_sec = 0;
                if (initialStats.tx_sec === null) initialStats.tx_sec = 0;
                if (initialStats.ms === null || initialStats.ms === 0) initialStats.ms = Date.now();
                logger.debug(`[${this.featureName}] Using systeminformation data for bridge ${ifaceName} with normalized speed values`);
              } else {
                // Fallback to bridge stats reader if systeminformation doesn't provide byte counters
                const realIfaceName = ifaceData.ifaceName || ifaceName;
                logger.debug(`[${this.featureName}] Systeminformation returned invalid data for bridge ${ifaceName}, trying bridge stats reader with real name: ${realIfaceName}`);
                const bridgeStatsResult = await BridgeStatsReader.readBridgeStats([realIfaceName]);
                if (bridgeStatsResult.length > 0) {
                  const bridgeStat = bridgeStatsResult[0];
                  initialStats = {
                    iface: ifaceName, // Keep normalized name for consistency
                    operstate: 'up',
                    rx_bytes: bridgeStat.rx_bytes,
                    rx_dropped: 0,
                    rx_errors: 0,
                    tx_bytes: bridgeStat.tx_bytes,
                    tx_dropped: 0,
                    tx_errors: 0,
                    rx_sec: 0,
                    tx_sec: 0,
                    ms: Date.now()
                  };
                  logger.debug(`[${this.featureName}] Got bridge stats for ${ifaceName} (real name: ${realIfaceName}, actual name: ${bridgeStat.iface}): rx=${bridgeStat.rx_bytes}, tx=${bridgeStat.tx_bytes}`);
                }
              }
            }
            
            if (initialStats) {
                this.previousNetStats[ifaceName] = initialStats;
                const totalRxGb = initialStats.rx_bytes / (1024 * 1024 * 1024);
                const totalTxGb = initialStats.tx_bytes / (1024 * 1024 * 1024);
                await this.publishState(`${this.featureName}/${ifaceName}/total_downloaded/state`, totalRxGb.toFixed(2), true);
                await this.publishState(`${this.featureName}/${ifaceName}/total_uploaded/state`, totalTxGb.toFixed(2), true);
            } else {
                 await this.publishState(`${this.featureName}/${ifaceName}/total_downloaded/state`, '0.00', true);
                 await this.publishState(`${this.featureName}/${ifaceName}/total_uploaded/state`, '0.00', true);
            }
        } catch (statsError) {
            logger.warn(`Could not get initial stats for ${ifaceName}: ${statsError}`);
            await this.publishState(`${this.featureName}/${ifaceName}/total_downloaded/state`, '0.00', true);
            await this.publishState(`${this.featureName}/${ifaceName}/total_uploaded/state`, '0.00', true);
        }
      }
    } catch (error) {
      logger.error(`Error discovering network interfaces for ${this.featureName}:`, error);
    }
    await Promise.all(discoveryPromises);
  }

  protected async update(): Promise<void> {
    try {
      const relevantInterfaces = await this.getRelevantInterfaces();
      const ifaceNamesToQuery = relevantInterfaces.map(iface => iface.iface);

      if (ifaceNamesToQuery.length === 0) {
        logger.debug(`No relevant interfaces found for ${this.featureName} update.`);
        return;
      }
      
      const currentInterfacesStatsResult = await si.networkStats(ifaceNamesToQuery.join(','));
      const statsArray = Array.isArray(currentInterfacesStatsResult) ? currentInterfacesStatsResult : [currentInterfacesStatsResult];
      logger.debug(`[${this.featureName}] Received stats from systeminformation for ${statsArray.length} interfaces:`, JSON.stringify(statsArray.map(s => s.iface), null, 2));

      // Try to get bridge stats as fallback for interfaces not found by systeminformation
      const bridgeInterfaces = relevantInterfaces
        .filter(iface => this.isBridgeInterface(iface.iface, iface.type))
        .map(iface => iface.ifaceName || iface.iface); // Use real interface names
      
      let bridgeStats: any[] = [];
      if (bridgeInterfaces.length > 0) {
        logger.debug(`[${this.featureName}] Attempting to read bridge stats for real names:`, bridgeInterfaces);
        const bridgeStatsResult = await BridgeStatsReader.readBridgeStats(bridgeInterfaces);
        bridgeStats = bridgeStatsResult.map(stat => ({
          iface: stat.iface, // Keep the actual name from /proc/net/dev 
          normalizedIface: stat.iface.toLowerCase(), // Add normalized name for matching
          operstate: 'up',
          rx_bytes: stat.rx_bytes,
          rx_dropped: 0,
          rx_errors: 0,
          tx_bytes: stat.tx_bytes,
          tx_dropped: 0,
          tx_errors: 0,
          rx_sec: 0,
          tx_sec: 0,
          ms: Date.now()
        }));
        logger.debug(`[${this.featureName}] Bridge stats from /proc/net/dev:`, bridgeStats.map(s => `${s.iface} (normalized: ${s.normalizedIface})`));
      }

      for (const ifaceData of relevantInterfaces) {
        const ifaceName = ifaceData.iface;
        let currentStat = statsArray.find(s => s.iface === ifaceName);
        
        // Handle bridge interfaces specially
        if (this.isBridgeInterface(ifaceName, ifaceData.type)) {
          if (currentStat) {
            // If systeminformation returned data but with null or suspicious zero speed values, normalize them
            if (currentStat.rx_sec === null) currentStat.rx_sec = 0;
            if (currentStat.tx_sec === null) currentStat.tx_sec = 0;
            if (currentStat.ms === null || currentStat.ms === 0) currentStat.ms = Date.now();
            // For bridges, if byte counters are null/0, try bridge stats fallback
            if (currentStat.rx_bytes === null || currentStat.tx_bytes === null || 
                (currentStat.rx_bytes === 0 && currentStat.tx_bytes === 0)) {
              const bridgeBackup = bridgeStats.find(s => s.normalizedIface === ifaceName.toLowerCase());
              if (bridgeBackup) {
                currentStat.rx_bytes = bridgeBackup.rx_bytes;
                currentStat.tx_bytes = bridgeBackup.tx_bytes;
                logger.debug(`[${this.featureName}] Using bridge stats fallback for byte counters on ${ifaceName} (matched with ${bridgeBackup.iface}): rx=${bridgeBackup.rx_bytes}, tx=${bridgeBackup.tx_bytes}`);
              }
            }
          } else {
            // If systeminformation didn't return stats for bridge, use bridge stats fallback
            currentStat = bridgeStats.find(s => s.normalizedIface === ifaceName.toLowerCase());
            if (currentStat) {
              logger.debug(`[${this.featureName}] Using bridge stats fallback for ${ifaceName} (matched with ${currentStat.iface})`);
            }
          }
        } else {
          // For non-bridge interfaces, use bridge stats fallback only if systeminformation failed
          if (!currentStat && bridgeStats.length > 0) {
            currentStat = bridgeStats.find(s => s.normalizedIface === ifaceName.toLowerCase());
            if (currentStat) {
              logger.debug(`[${this.featureName}] Using bridge stats fallback for non-bridge ${ifaceName} (matched with ${currentStat.iface})`);
            }
          }
        }

        if (!currentStat) {
          logger.warn(`[${this.featureName}] No stats returned by systeminformation or bridge fallback for interface: ${ifaceName}. Publishing 0/error.`);
          await this.publishState(`${this.featureName}/${ifaceName}/download_speed/state`, '0.00', false);
          await this.publishState(`${this.featureName}/${ifaceName}/upload_speed/state`, '0.00', false);
          continue; // Skip to next relevant interface
        }
        
        logger.debug(`[${this.featureName}] Processing stats for interface: ${ifaceName}`, JSON.stringify(currentStat, null, 2));
        const previousStat = this.previousNetStats[ifaceName];
        if (!previousStat) {
          logger.debug(`[${this.featureName}] No previous stats for ${ifaceName}. First cycle - will publish 0 speed.`);
        }
         // Only calculate speed if we have valid previous statistics from a real previous measurement
        if (this.featureConfig.update_interval_seconds && this.featureConfig.update_interval_seconds > 0 && previousStat && 
            previousStat.rx_bytes !== undefined && previousStat.tx_bytes !== undefined) {
          const intervalSeconds = this.featureConfig.update_interval_seconds;
          
          const rxBytesDiff = currentStat.rx_bytes - previousStat.rx_bytes;
          const txBytesDiff = currentStat.tx_bytes - previousStat.tx_bytes;

          // Check for reasonable byte differences to avoid astronomical speeds
          // If difference is negative or too large, it's likely a counter reset or error
          const maxReasonableBytes = 10 * 1024 * 1024 * 1024; // 10GB per interval is reasonable max
          
          let rxSpeedMbps = 0;
          let txSpeedMbps = 0;
          
          if (rxBytesDiff >= 0 && rxBytesDiff < maxReasonableBytes) {
            const rxSpeedBps = (rxBytesDiff * 8) / intervalSeconds;
            rxSpeedMbps = rxSpeedBps / 1000000;
          }
          
          if (txBytesDiff >= 0 && txBytesDiff < maxReasonableBytes) {
            const txSpeedBps = (txBytesDiff * 8) / intervalSeconds;
            txSpeedMbps = txSpeedBps / 1000000;
          }

          // Log calculation details for debugging
          logger.debug(`[${this.featureName}] ${ifaceName} speed calculation:
            Current RX: ${currentStat.rx_bytes}, Previous RX: ${previousStat.rx_bytes}, Diff: ${rxBytesDiff}
            Current TX: ${currentStat.tx_bytes}, Previous TX: ${previousStat.tx_bytes}, Diff: ${txBytesDiff}
            Interval: ${intervalSeconds}s, RX speed: ${rxSpeedMbps.toFixed(2)} Mbps, TX speed: ${txSpeedMbps.toFixed(2)} Mbps`);

          await this.publishState(`${this.featureName}/${ifaceName}/download_speed/state`, rxSpeedMbps.toFixed(2), false);
          await this.publishState(`${this.featureName}/${ifaceName}/upload_speed/state`, txSpeedMbps.toFixed(2), false);
        } else {
            // No previous stats, first run, or invalid interval - publish 0 speed
            logger.debug(`[${this.featureName}] ${ifaceName}: No previous stats or invalid interval, publishing 0 speed`);
            await this.publishState(`${this.featureName}/${ifaceName}/download_speed/state`, '0.00', false);
            await this.publishState(`${this.featureName}/${ifaceName}/upload_speed/state`, '0.00', false);
        }
        
        const totalRxGb = currentStat.rx_bytes / (1024 * 1024 * 1024);
        const totalTxGb = currentStat.tx_bytes / (1024 * 1024 * 1024);
        await this.publishState(`${this.featureName}/${ifaceName}/total_downloaded/state`, totalRxGb.toFixed(2), true);
        await this.publishState(`${this.featureName}/${ifaceName}/total_uploaded/state`, totalTxGb.toFixed(2), true);

        this.previousNetStats[ifaceName] = { ...currentStat }; // Store a copy
      }
    } catch (error) {
      logger.error(`Error updating network stats for ${this.featureName}:`, error);
    }
  }
}
