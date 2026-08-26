// src/utils/macVendor/HybridMacVendorLookup.ts

import { OnlineMacVendorLookup, MacVendorInfo } from './OnlineMacVendorLookup';
import { StaticMacVendorLookup } from './StaticMacVendorLookup';
import logger from '../logger';

/**
 * Hybrid MAC vendor lookup that combines online and static sources
 * Primary: Online lookup with caching
 * Fallback: Static database for offline/failure scenarios
 */
export class HybridMacVendorLookup {
  private static readonly USE_ONLINE_LOOKUP = true;
  private static readonly ONLINE_TIMEOUT = 5000; // 5 seconds

  /**
   * Lookup vendor information for a MAC address
   * Tries online first, falls back to static database
   */
  static async lookupVendor(macAddress: string): Promise<MacVendorInfo> {
    if (!macAddress) return {};

    // Try online lookup first if enabled
    if (this.USE_ONLINE_LOOKUP) {
      try {
        const onlineResult = await Promise.race([
          OnlineMacVendorLookup.lookupVendor(macAddress),
          new Promise<MacVendorInfo>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), this.ONLINE_TIMEOUT)
          )
        ]);

        if (onlineResult && onlineResult.vendor) {
          logger.debug(`Found vendor online: ${onlineResult.vendor} for MAC ${macAddress}`);
          return onlineResult;
        }
      } catch (error) {
        logger.debug(`Online lookup failed for ${macAddress}:`, error);
      }
    }

    // Fallback to static database
    const staticResult = StaticMacVendorLookup.lookupVendor(macAddress);
    if (staticResult && staticResult.vendor) {
      logger.debug(`Found vendor in static DB: ${staticResult.vendor} for MAC ${macAddress}`);
      return staticResult;
    }

    logger.debug(`No vendor found for MAC ${macAddress}`);
    return {};
  }

  /**
   * Batch lookup for multiple MAC addresses
   */
  static async batchLookup(macAddresses: string[]): Promise<Map<string, MacVendorInfo>> {
    const results = new Map<string, MacVendorInfo>();
    
    if (!macAddresses.length) return results;

    // Try online batch lookup first
    if (this.USE_ONLINE_LOOKUP) {
      try {
        const onlineResults = await Promise.race([
          OnlineMacVendorLookup.batchLookup(macAddresses),
          new Promise<Map<string, MacVendorInfo>>((_, reject) => 
            setTimeout(() => reject(new Error('Batch timeout')), this.ONLINE_TIMEOUT * 2)
          )
        ]);

        // Merge online results
        for (const [mac, info] of onlineResults) {
          if (info && info.vendor) {
            results.set(mac, info);
          }
        }

        logger.debug(`Online batch lookup found ${results.size}/${macAddresses.length} vendors`);
      } catch (error) {
        logger.debug('Online batch lookup failed:', error);
      }
    }

    // Fill missing entries with static lookup
    for (const macAddress of macAddresses) {
      if (!results.has(macAddress)) {
        const staticResult = StaticMacVendorLookup.lookupVendor(macAddress);
        if (staticResult && staticResult.vendor) {
          results.set(macAddress, staticResult);
        }
      }
    }

    logger.debug(`Final batch lookup result: ${results.size}/${macAddresses.length} vendors found`);
    return results;
  }

  /**
   * Check if MAC address appears to be virtual/emulated
   */
  static isVirtualMac(macAddress: string): boolean {
    return StaticMacVendorLookup.isVirtualMac(macAddress);
  }

  /**
   * Get a user-friendly device type based on MAC vendor
   */
  static async getDeviceType(macAddress: string): Promise<string> {
    const vendorInfo = await this.lookupVendor(macAddress);
    
    if (!vendorInfo.vendor) {
      return 'Unknown Device';
    }
    
    if (this.isVirtualMac(macAddress)) {
      return 'Virtual Machine';
    }
    
    const vendor = vendorInfo.vendor.toLowerCase();
    
    if (vendor.includes('apple')) return 'Apple Device';
    if (vendor.includes('samsung')) return 'Samsung Device';
    if (vendor.includes('intel')) return 'Intel Device';
    if (vendor.includes('nvidia')) return 'Nvidia Device';
    if (vendor.includes('google')) return 'Google Device';
    if (vendor.includes('amazon')) return 'Amazon Device';
    if (vendor.includes('asus')) return 'ASUS Device';
    if (vendor.includes('tp-link')) return 'TP-Link Device';
    if (vendor.includes('netgear')) return 'Netgear Device';
    if (vendor.includes('d-link')) return 'D-Link Device';
    if (vendor.includes('vmware')) return 'Virtual Machine';
    if (vendor.includes('qemu')) return 'Virtual Machine';
    if (vendor.includes('virtualbox')) return 'Virtual Machine';
    if (vendor.includes('microsoft') && vendor.includes('corporation')) return 'Microsoft Device';
    
    return 'Network Device';
  }

  /**
   * Get enhanced device information including vendor and type
   */
  static async getDeviceInfo(macAddress: string): Promise<MacVendorInfo & { deviceType: string }> {
    const vendorInfo = await this.lookupVendor(macAddress);
    const deviceType = await this.getDeviceType(macAddress);
    
    return {
      ...vendorInfo,
      deviceType
    };
  }

  /**
   * Clean expired cache entries
   */
  static async cleanCache(): Promise<void> {
    if (this.USE_ONLINE_LOOKUP) {
      await OnlineMacVendorLookup.cleanCache();
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{
    entries: number;
    validEntries: number;
    expiredEntries: number;
  }> {
    if (this.USE_ONLINE_LOOKUP) {
      return await OnlineMacVendorLookup.getCacheStats();
    }
    
    return { entries: 0, validEntries: 0, expiredEntries: 0 };
  }
}
