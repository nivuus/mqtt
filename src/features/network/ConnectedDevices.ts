// src/features/network/ConnectedDevices.ts

import { BaseFeature } from '../../core/BaseFeature';
import { MqttClient, FeatureConfig } from '../../core/types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';
import { MacVendorLookup } from '../../utils/macVendor';
import logger from '../../utils/logger';
import { cleanHostname, DEFAULT_DNSMASQ_LEASE_DIR, readBridgeLeases } from './dnsmasqLeases';
import { reverseLookup } from './reverseDns';

interface ConnectedDevicesFeatureConfig extends FeatureConfig {
  bridge_interfaces?: string[];
  /** Where NetworkManager's dnsmasq keeps `dnsmasq-<bridge>.leases`. */
  dnsmasq_lease_dir?: string;
}

interface ConnectedDevice {
  ip: string;
  mac: string;
  hostname?: string;
  bridge: string;
  lease_time?: string;
  vendor?: string;
  connection_type: 'arp' | 'dhcp' | 'both';
}

interface BridgeInfo {
  name: string;
  ip?: string;
  subnet?: string;
  cidr?: string;
}

/** The host's LAN bridges; Docker and libvirt bridges are left out. */
const MONITORED_BRIDGES = new Set(['localBridge', 'publicBridge', 'internalBridge']);

/** Every command here only reads, on every tick: logged at debug (see execute_argv `quiet`). */
const run = (file: string, args: string[]) => execute_argv(file, args, { quiet: true });

export class ConnectedDevices extends BaseFeature {
  protected featureConfig: ConnectedDevicesFeatureConfig;

  constructor(mqttClient: MqttClient, featureName: string = 'connected_devices') {
    super(mqttClient, featureName);
    this.featureConfig = this.agentConfig.features[featureName] as ConnectedDevicesFeatureConfig ||
                         { enabled: true, update_interval_seconds: 60 };
  }

  private async getBridgeInterfaces(): Promise<BridgeInfo[]> {
    const bridges: BridgeInfo[] = [];
    const result = await run('ip', ['addr', 'show']);
    if (result.exitCode !== 0) {
      logger.error(`Error detecting bridge interfaces: ip addr show exited ${result.exitCode}: ${result.stderr.trim()}`);
      return bridges;
    }
    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^\d+:\s*([\w-]+):/);
      if (match && MONITORED_BRIDGES.has(match[1])) {
        const bridgeInfo = await this.getBridgeInfo(match[1]);
        if (bridgeInfo) bridges.push(bridgeInfo);
      }
    }
    return bridges;
  }

  private async getBridgeInfo(bridgeName: string): Promise<BridgeInfo | null> {
    const result = await run('ip', ['addr', 'show', bridgeName]);
    if (result.exitCode !== 0) return null;

    const bridge: BridgeInfo = { name: bridgeName };
    const ipMatch = result.stdout.match(/inet (\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (ipMatch) {
      bridge.ip = ipMatch[1];
      bridge.cidr = ipMatch[2];
      const cidr = parseInt(ipMatch[2]);
      bridge.subnet = Array(4).fill(0).map((_, i) => {
        const bits = Math.max(0, Math.min(8, cidr - i * 8));
        return 256 - Math.pow(2, 8 - bits);
      }).join('.');
    }
    return bridge;
  }

  private async getArpDevices(bridgeName: string): Promise<ConnectedDevice[]> {
    const devices: ConnectedDevice[] = [];
    const neighResult = await run('ip', ['neigh', 'show', 'dev', bridgeName]);
    if (neighResult.exitCode !== 0) {
      logger.error(`Error getting neighbours of ${bridgeName}: exit ${neighResult.exitCode}: ${neighResult.stderr.trim()}`);
      return devices;
    }
    for (const line of neighResult.stdout.split('\n')) {
      const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+lladdr\s+([\w:]+)\s+(\w+)/);
      if (match && (match[3] === 'REACHABLE' || match[3] === 'STALE' || match[3] === 'DELAY')) {
        devices.push({ ip: match[1], mac: match[2].toLowerCase(), bridge: bridgeName, connection_type: 'arp' });
      }
    }
    return devices;
  }

  private async getDhcpDevices(bridgeName: string): Promise<ConnectedDevice[]> {
    const dir = this.featureConfig.dnsmasq_lease_dir || DEFAULT_DNSMASQ_LEASE_DIR;
    try {
      const leases = await readBridgeLeases(dir, bridgeName);
      return leases.map(lease => ({
        ip: lease.ip,
        mac: lease.mac,
        hostname: lease.hostname,
        lease_time: lease.expires,
        bridge: bridgeName,
        connection_type: 'dhcp' as const,
      }));
    } catch (error: any) {
      logger.error(`Error reading the DHCP leases of ${bridgeName} in ${dir}: ${error.message}`);
      return [];
    }
  }

  /** The short reverse-DNS name of a LAN address, cleaned like a lease name. */
  private async resolveHostname(ip: string): Promise<string | undefined> {
    if (!Validators.isIPv4(ip)) return undefined;
    // Docker, link-local and loopback addresses have no useful PTR record.
    if (/^172\.(1[7-9]|20)\./.test(ip) || ip.startsWith('169.254.') || ip === '127.0.0.1') return undefined;
    const fqdn = cleanHostname(await reverseLookup(ip));
    if (!fqdn) return undefined;
    const shortName = fqdn.replace(/\.$/, '').split('.')[0];
    return shortName.length > 1 ? shortName : fqdn;
  }

  private async getBridgeDevices(bridgeName: string): Promise<ConnectedDevice[]> {
    const devices: ConnectedDevice[] = [];
    
    try {
      // Get devices from ARP table
      const arpDevices = await this.getArpDevices(bridgeName);
      devices.push(...arpDevices);

      // Get devices from DHCP leases
      const dhcpDevices = await this.getDhcpDevices(bridgeName);
      
      // Merge DHCP info with ARP info
      for (const dhcpDevice of dhcpDevices) {
        const existingDevice = devices.find(d => d.mac === dhcpDevice.mac || d.ip === dhcpDevice.ip);
        if (existingDevice) {
          existingDevice.hostname = dhcpDevice.hostname || existingDevice.hostname;
          existingDevice.lease_time = dhcpDevice.lease_time;
          existingDevice.connection_type = 'both';
        } else {
          devices.push(dhcpDevice);
        }
      }

      // Try to resolve hostnames for devices without names (parallelized for performance)
      const hostnameResolutions = devices
        .filter(device => !device.hostname && device.ip)
        .map(async (device) => {
          device.hostname = await this.resolveHostname(device.ip);
        });

      if (hostnameResolutions.length > 0) {
        await Promise.all(hostnameResolutions);
      }

      // Batch lookup MAC vendors for better performance
      const macAddresses = devices.filter(d => d.mac).map(d => d.mac);
      if (macAddresses.length > 0) {
        try {
          const vendorResults = await MacVendorLookup.batchLookup(macAddresses);
          for (const device of devices) {
            if (device.mac) {
              const vendorInfo = vendorResults.get(device.mac);
              if (vendorInfo && vendorInfo.vendor) {
                device.vendor = vendorInfo.vendor;
              }
            }
          }
        } catch (error) {
          logger.error(`Error during batch vendor lookup for bridge ${bridgeName}:`, error);
          // Fallback to individual lookups
          for (const device of devices) {
            if (device.mac) {
              try {
                const vendorInfo = await MacVendorLookup.lookupVendor(device.mac);
                if (vendorInfo.vendor) {
                  device.vendor = vendorInfo.vendor;
                }
              } catch (err) {
                logger.debug(`Error looking up vendor for MAC ${device.mac}:`, err);
              }
            }
          }
        }
      }

    } catch (error) {
      logger.error(`Error getting devices for bridge ${bridgeName}:`, error);
    }

    return devices;
  }

  protected async publishDiscovery(): Promise<void> {
    const bridges = await this.getBridgeInterfaces();
    
    for (const bridge of bridges) {
      const objectId = bridge.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      await this.publishEntityDiscovery('sensor', `${objectId}_device_count`, {
        name: `Network ${bridge.name} Device Count`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/count/state`),
        icon: 'mdi:counter',
        entity_category: 'diagnostic' as 'diagnostic',
      });

      await this.publishEntityDiscovery('sensor', `${objectId}_devices`, {
        name: `Network ${bridge.name} Connected Devices`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/devices/state`),
        icon: 'mdi:lan-connect',
        entity_category: 'diagnostic' as 'diagnostic',
        json_attributes_topic: this.prefixTopic(`${this.featureName}/${objectId}/devices/attributes`),
      });

      await this.publishEntityDiscovery('sensor', `${objectId}_bridge_info`, {
        name: `Network ${bridge.name} Bridge Info`,
        state_topic: this.prefixTopic(`${this.featureName}/${objectId}/bridge_info/state`),
        icon: 'mdi:bridge',
        entity_category: 'diagnostic' as 'diagnostic',
        json_attributes_topic: this.prefixTopic(`${this.featureName}/${objectId}/bridge_info/attributes`),
      });
    }
  }

  protected async update(): Promise<void> {
    const bridges = await this.getBridgeInterfaces();
    
    if (bridges.length === 0) {
      logger.debug(`No bridge interfaces found for ${this.featureName}.`);
      return;
    }

    for (const bridge of bridges) {
      const objectId = bridge.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      try {
        const devices = await this.getBridgeDevices(bridge.name);
        
        // Publish device count
        await this.publishState(`${this.featureName}/${objectId}/count/state`, devices.length, true);
        
        // Publish devices list
        await this.publishState(`${this.featureName}/${objectId}/devices/state`, 
          devices.length > 0 ? `${devices.length} devices` : 'No devices', true);
        
        // Publish device details as attributes
        const deviceAttributes = {
          devices: devices.map(d => ({
            ip: d.ip,
            mac: d.mac,
            hostname: d.hostname || 'Unknown',
            vendor: d.vendor || 'Unknown',
            lease_time: d.lease_time,
            connection_type: d.connection_type
          })),
          last_updated: new Date().toISOString(),
          bridge_name: bridge.name
        };
        await this.publishState(`${this.featureName}/${objectId}/devices/attributes`, 
          JSON.stringify(deviceAttributes), true);

        // Publish bridge info
        await this.publishState(`${this.featureName}/${objectId}/bridge_info/state`, 
          bridge.ip ? `${bridge.ip}/${bridge.cidr}` : 'No IP', true);
        
        const bridgeAttributes = {
          name: bridge.name,
          ip: bridge.ip,
          subnet_mask: bridge.subnet,
          cidr: bridge.cidr,
          device_count: devices.length
        };
        await this.publishState(`${this.featureName}/${objectId}/bridge_info/attributes`, 
          JSON.stringify(bridgeAttributes), true);

      } catch (error: any) {
        logger.error(`Error updating connected devices for bridge ${bridge.name}:`, error.message);
        await this.publishState(`${this.featureName}/${objectId}/count/state`, 'Error', true);
        await this.publishState(`${this.featureName}/${objectId}/devices/state`, 'Error', true);
      }
    }
  }
}
