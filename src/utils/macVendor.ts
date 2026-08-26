// src/utils/macVendor.ts
// Legacy file - use the new modular approach in macVendor/ directory

export { HybridMacVendorLookup as MacVendorLookup } from './macVendor/HybridMacVendorLookup';
export { HybridMacVendorLookup } from './macVendor/HybridMacVendorLookup';
export { OnlineMacVendorLookup } from './macVendor/OnlineMacVendorLookup';
export { StaticMacVendorLookup } from './macVendor/StaticMacVendorLookup';

// Deprecated: Legacy class for backward compatibility
interface MacVendorInfo {
  vendor?: string;
  model?: string;
}

/**
 * @deprecated Use HybridMacVendorLookup from './macVendor' instead
 * Simple MAC vendor lookup using built-in OUI prefixes
 * For more complete database, you could use external APIs or local OUI files
 */
export class LegacyMacVendorLookup {
  private static readonly OUI_DATABASE: { [key: string]: MacVendorInfo } = {
    // Common virtualization vendors
    '00:0c:29': { vendor: 'VMware' },
    '00:15:5d': { vendor: 'Microsoft Corporation' },
    '00:16:3e': { vendor: 'Xensource' },
    '00:50:56': { vendor: 'VMware' },
    '08:00:27': { vendor: 'Oracle VirtualBox' },
    '52:54:00': { vendor: 'QEMU Virtual NIC' },

    // Intel Corporation
    '00:04:4b': { vendor: 'Nvidia Corporation' },
    '00:1b:21': { vendor: 'Intel Corporation' },
    '00:a0:c9': { vendor: 'Intel Corporation' },
    '0c:47:c9': { vendor: 'Intel Corporation' },
    '34:ce:00': { vendor: 'Intel Corporation' },
    '40:aa:56': { vendor: 'Intel Corporation' },
    '48:e1:e9': { vendor: 'Intel Corporation' },
    '60:b6:06': { vendor: 'Intel Corporation' },
    '74:c2:46': { vendor: 'Intel Corporation' },
    '78:11:dc': { vendor: 'Intel Corporation' },
    '78:21:84': { vendor: 'Intel Corporation' },
    '7c:49:eb': { vendor: 'Intel Corporation' },
    '8c:17:59': { vendor: 'Intel Corporation' },
    '8c:aa:b5': { vendor: 'Intel Corporation' },
    'a0:92:08': { vendor: 'Intel Corporation' },
    'b0:2a:43': { vendor: 'Intel Corporation' },
    'd4:f5:47': { vendor: 'Intel Corporation' },
    'd8:c8:0c': { vendor: 'Intel Corporation' },
    'e4:b0:63': { vendor: 'Intel Corporation' },
    'f0:27:2d': { vendor: 'Intel Corporation' },
    'f4:a9:97': { vendor: 'Intel Corporation' },

    // Apple devices
    '00:03:93': { vendor: 'Apple' },
    '00:0a:95': { vendor: 'Apple' },
    '00:11:24': { vendor: 'Apple' },
    '00:14:51': { vendor: 'Apple' },
    '00:16:cb': { vendor: 'Apple' },
    '00:17:f2': { vendor: 'Apple' },
    '00:19:e3': { vendor: 'Apple' },
    '00:1b:63': { vendor: 'Apple' },
    '00:1e:c2': { vendor: 'Apple' },
    '00:21:e9': { vendor: 'Apple' },
    '00:23:12': { vendor: 'Apple' },
    '00:23:df': { vendor: 'Apple' },
    '00:25:00': { vendor: 'Apple' },
    '00:25:4b': { vendor: 'Apple' },
    '00:25:bc': { vendor: 'Apple' },
    '00:26:08': { vendor: 'Apple' },
    '00:26:4a': { vendor: 'Apple' },
    '00:26:b0': { vendor: 'Apple' },
    '00:26:bb': { vendor: 'Apple' },
    '04:0c:ce': { vendor: 'Apple' },
    '04:1e:64': { vendor: 'Apple' },
    '04:69:f8': { vendor: 'Apple' },
    '04:db:56': { vendor: 'Apple' },
    '04:e5:36': { vendor: 'Apple' },
    '04:f1:3e': { vendor: 'Apple' },
    '08:74:02': { vendor: 'Apple' },
    '0c:3e:9f': { vendor: 'Apple' },
    '0c:4d:e9': { vendor: 'Apple' },
    '0c:d2:92': { vendor: 'Apple' },
    '10:40:f3': { vendor: 'Apple' },
    '10:9a:dd': { vendor: 'Apple' },
    '14:10:9f': { vendor: 'Apple' },
    '14:5a:05': { vendor: 'Apple' },
    '14:7d:da': { vendor: 'Apple' },
    '14:bd:61': { vendor: 'Apple' },
    '18:af:61': { vendor: 'Apple' },
    '1c:1a:c0': { vendor: 'Apple' },
    '1c:ab:a7': { vendor: 'Apple' },
    '20:78:f0': { vendor: 'Apple' },
    '20:c9:d0': { vendor: 'Apple' },
    '24:a0:74': { vendor: 'Apple' },
    '24:ab:81': { vendor: 'Apple' },
    '28:37:37': { vendor: 'Apple' },
    '28:cf:da': { vendor: 'Apple' },
    '28:cf:e9': { vendor: 'Apple' },
    '28:e0:2c': { vendor: 'Apple' },
    '28:e7:cf': { vendor: 'Apple' },
    '2c:1f:23': { vendor: 'Apple' },
    '2c:b4:3a': { vendor: 'Apple' },
    '30:90:ab': { vendor: 'Apple' },
    '34:15:9e': { vendor: 'Apple' },
    '34:36:3b': { vendor: 'Apple' },
    '34:a3:95': { vendor: 'Apple' },

    // Samsung devices
    '00:00:f0': { vendor: 'Samsung' },
    '00:12:fb': { vendor: 'Samsung' },
    '00:15:99': { vendor: 'Samsung' },
    '00:16:32': { vendor: 'Samsung' },
    '00:16:6b': { vendor: 'Samsung' },
    '00:16:db': { vendor: 'Samsung' },
    '00:17:c9': { vendor: 'Samsung' },
    '00:18:af': { vendor: 'Samsung' },
    '00:1a:8a': { vendor: 'Samsung' },
    '00:1d:25': { vendor: 'Samsung' },
    '00:21:19': { vendor: 'Samsung' },
    '00:23:39': { vendor: 'Samsung' },
    '00:26:37': { vendor: 'Samsung' },
    '04:18:d6': { vendor: 'Samsung' },
    '08:37:3d': { vendor: 'Samsung' },
    '0c:14:20': { vendor: 'Samsung' },
    '0c:71:5d': { vendor: 'Samsung' },
    '10:1d:c0': { vendor: 'Samsung' },
    '14:7f:c2': { vendor: 'Samsung' },
    '18:3a:2d': { vendor: 'Samsung' },
    '1c:62:b8': { vendor: 'Samsung' },
    '20:64:32': { vendor: 'Samsung' },
    '24:4b:03': { vendor: 'Samsung' },
    '28:ba:b5': { vendor: 'Samsung' },
    '2c:44:01': { vendor: 'Samsung' },
    '30:07:4d': { vendor: 'Samsung' },
    '34:23:87': { vendor: 'Samsung' },
    '38:aa:3c': { vendor: 'Samsung' },
    '3c:8b:fe': { vendor: 'Samsung' },
    '40:0e:85': { vendor: 'Samsung' },
    '44:4e:6d': { vendor: 'Samsung' },
    '48:5a:3f': { vendor: 'Samsung' },
    '4c:3c:16': { vendor: 'Samsung' },
    '50:32:37': { vendor: 'Samsung' },
    '54:88:0e': { vendor: 'Samsung' },
    '58:21:83': { vendor: 'Samsung' },
    '5c:0a:5b': { vendor: 'Samsung' },
    '60:6d:c7': { vendor: 'Samsung' },
    '64:b8:53': { vendor: 'Samsung' },
    '68:eb:c5': { vendor: 'Samsung' },
    '6c:2f:2c': { vendor: 'Samsung' },
    '70:f9:27': { vendor: 'Samsung' },
    '74:45:8a': { vendor: 'Samsung' },
    '78:1f:db': { vendor: 'Samsung' },
    '7c:61:66': { vendor: 'Samsung' },
    '80:18:a7': { vendor: 'Samsung' },
    '84:38:38': { vendor: 'Samsung' },
    '88:32:9b': { vendor: 'Samsung' },
    '8c:f5:a3': { vendor: 'Samsung' },
    '90:18:7c': { vendor: 'Samsung' },
    '94:e9:79': { vendor: 'Samsung' },
    '98:22:ef': { vendor: 'Samsung' },
    '9c:02:98': { vendor: 'Samsung' },
    'a0:0b:ba': { vendor: 'Samsung' },
    'a4:eb:d3': { vendor: 'Samsung' },
    'a8:be:27': { vendor: 'Samsung' },
    'ac:36:13': { vendor: 'Samsung' },
    'b0:79:94': { vendor: 'Samsung' },
    'b4:62:93': { vendor: 'Samsung' },
    'b8:5e:7b': { vendor: 'Samsung' },
    'bc:20:a4': { vendor: 'Samsung' },
    'c0:bd:d1': { vendor: 'Samsung' },
    'c4:73:1e': { vendor: 'Samsung' },
    'c8:ba:94': { vendor: 'Samsung' },
    'cc:07:ab': { vendor: 'Samsung' },
    'd0:22:be': { vendor: 'Samsung' },
    'd4:87:d8': { vendor: 'Samsung' },
    'd8:90:e8': { vendor: 'Samsung' },
    'dc:71:96': { vendor: 'Samsung' },
    'e0:cb:ee': { vendor: 'Samsung' },
    'e4:92:fb': { vendor: 'Samsung' },
    'e8:50:8b': { vendor: 'Samsung' },
    'ec:1f:72': { vendor: 'Samsung' },
    'f0:25:b7': { vendor: 'Samsung' },
    'f4:0f:24': { vendor: 'Samsung' },
    'f8:04:2e': { vendor: 'Samsung' },
    'fc:00:12': { vendor: 'Samsung' },

    // Google/Nest devices
    '18:b4:30': { vendor: 'Google' },
    '20:df:b9': { vendor: 'Google' },
    '40:f3:08': { vendor: 'Google' },
    '44:07:0b': { vendor: 'Google' },
    '48:d6:d5': { vendor: 'Google' },
    '6c:ad:f8': { vendor: 'Google' },
    '80:1f:02': { vendor: 'Google' },
    '84:f3:eb': { vendor: 'Google' },
    'a4:77:33': { vendor: 'Google' },
    'cc:3a:61': { vendor: 'Google' },
    'f8:8f:ca': { vendor: 'Google' },

    // Amazon devices  
    '18:74:2e': { vendor: 'Amazon' },
    '38:f7:3d': { vendor: 'Amazon' },
    '44:65:0d': { vendor: 'Amazon' },
    '50:dc:e7': { vendor: 'Amazon' },
    '84:d6:d0': { vendor: 'Amazon' },
    'ac:63:be': { vendor: 'Amazon' },

    // ASUS devices
    '00:15:f2': { vendor: 'ASUS' },
    '00:1b:fc': { vendor: 'ASUS' },
    '00:1e:8c': { vendor: 'ASUS' },
    '00:22:15': { vendor: 'ASUS' },
    '00:24:8c': { vendor: 'ASUS' },
    '00:26:18': { vendor: 'ASUS' },
    '04:92:26': { vendor: 'ASUS' },
    '08:60:6e': { vendor: 'ASUS' },
    '0c:9d:92': { vendor: 'ASUS' },
    '10:bf:48': { vendor: 'ASUS' },
    '14:dd:a9': { vendor: 'ASUS' },
    '1c:87:2c': { vendor: 'ASUS' },
    '20:cf:30': { vendor: 'ASUS' },
    '2c:56:dc': { vendor: 'ASUS' },
    '30:5a:3a': { vendor: 'ASUS' },
    '38:d5:47': { vendor: 'ASUS' },
    '40:16:7e': { vendor: 'ASUS' },
    '50:46:5d': { vendor: 'ASUS' },
    '60:45:cb': { vendor: 'ASUS' },
    '70:4d:7b': { vendor: 'ASUS' },
    '88:d7:f6': { vendor: 'ASUS' },
    '9c:5c:8e': { vendor: 'ASUS' },
    'ac:9e:17': { vendor: 'ASUS' },
    'b0:6e:bf': { vendor: 'ASUS' },
    'c8:60:00': { vendor: 'ASUS' },
    'd0:17:c2': { vendor: 'ASUS' },
    'e0:3f:49': { vendor: 'ASUS' },
    'f4:6d:04': { vendor: 'ASUS' },

    // TP-Link devices
    '00:13:46': { vendor: 'TP-Link' },
    '00:27:19': { vendor: 'TP-Link' },
    '04:8d:38': { vendor: 'TP-Link' },
    '14:cc:20': { vendor: 'TP-Link' },
    '18:d6:c7': { vendor: 'TP-Link' },
    '1c:61:b4': { vendor: 'TP-Link' },
    '24:05:0f': { vendor: 'TP-Link' },
    '2c:30:33': { vendor: 'TP-Link' },
    '30:b5:c2': { vendor: 'TP-Link' },
    '34:97:f6': { vendor: 'TP-Link' },
    '3c:84:6a': { vendor: 'TP-Link' },
    '44:94:fc': { vendor: 'TP-Link' },
    '50:c7:bf': { vendor: 'TP-Link' },
    '5c:62:8b': { vendor: 'TP-Link' },
    '60:e3:27': { vendor: 'TP-Link' },
    '68:ff:7b': { vendor: 'TP-Link' },
    '70:4f:57': { vendor: 'TP-Link' },
    '78:8a:20': { vendor: 'TP-Link' },
    '84:16:f9': { vendor: 'TP-Link' },
    '8c:53:c3': { vendor: 'TP-Link' },
    '94:b9:7e': { vendor: 'TP-Link' },
    '98:da:c4': { vendor: 'TP-Link' },
    'a0:f3:c1': { vendor: 'TP-Link' },
    'a4:2b:b0': { vendor: 'TP-Link' },
    'ac:84:c6': { vendor: 'TP-Link' },
    'b0:95:75': { vendor: 'TP-Link' },
    'c0:25:e9': { vendor: 'TP-Link' },
    'c4:6e:1f': { vendor: 'TP-Link' },
    'c8:0e:14': { vendor: 'TP-Link' },
    'd4:6e:0e': { vendor: 'TP-Link' },
    'dc:9f:db': { vendor: 'TP-Link' },
    'e8:48:b8': { vendor: 'TP-Link' },
    'ec:08:6b': { vendor: 'TP-Link' },
    'f4:f2:6d': { vendor: 'TP-Link' },
    'fc:ec:da': { vendor: 'TP-Link' },

    // Netgear devices
    '00:09:5b': { vendor: 'Netgear' },
    '00:0f:b5': { vendor: 'Netgear' },
    '00:14:6c': { vendor: 'Netgear' },
    '00:18:e7': { vendor: 'Netgear' },
    '00:1b:2f': { vendor: 'Netgear' },
    '00:1e:2a': { vendor: 'Netgear' },
    '00:22:3f': { vendor: 'Netgear' },
    '00:24:b2': { vendor: 'Netgear' },
    '00:26:f2': { vendor: 'Netgear' },
    '04:a1:51': { vendor: 'Netgear' },
    '08:bd:43': { vendor: 'Netgear' },
    '10:0d:7f': { vendor: 'Netgear' },
    '20:4e:7f': { vendor: 'Netgear' },
    '28:c6:8e': { vendor: 'Netgear' },
    '30:46:9a': { vendor: 'Netgear' },
    '3c:37:86': { vendor: 'Netgear' },
    '5c:33:8e': { vendor: 'Netgear' },
    '6c:cd:d6': { vendor: 'Netgear' },
    '84:1b:5e': { vendor: 'Netgear' },
    '9c:3d:cf': { vendor: 'Netgear' },
    'a0:04:60': { vendor: 'Netgear' },
    'a0:40:a0': { vendor: 'Netgear' },
    'b0:7f:b9': { vendor: 'Netgear' },
    'c0:3f:0e': { vendor: 'Netgear' },
    'cc:40:d0': { vendor: 'Netgear' },
    'e0:91:f5': { vendor: 'Netgear' },
    'e4:f4:c6': { vendor: 'Netgear' },

    // D-Link devices
    '00:05:5d': { vendor: 'D-Link' },
    '00:0d:88': { vendor: 'D-Link' },
    '00:11:95': { vendor: 'D-Link' },
    '00:15:e9': { vendor: 'D-Link' },
    '00:17:9a': { vendor: 'D-Link' },
    '00:19:5b': { vendor: 'D-Link' },
    '00:1b:11': { vendor: 'D-Link' },
    '00:1c:f0': { vendor: 'D-Link' },
    '00:1e:58': { vendor: 'D-Link' },
    '00:21:91': { vendor: 'D-Link' },
    '00:22:b0': { vendor: 'D-Link' },
    '00:24:01': { vendor: 'D-Link' },
    '00:26:5a': { vendor: 'D-Link' },
    '14:d6:4d': { vendor: 'D-Link' },
    '1c:7e:e5': { vendor: 'D-Link' },
    '28:10:7b': { vendor: 'D-Link' },
    '34:08:04': { vendor: 'D-Link' },
    '5c:d9:98': { vendor: 'D-Link' },
    '84:c9:b2': { vendor: 'D-Link' },
    '90:94:e4': { vendor: 'D-Link' },
    'c0:a0:bb': { vendor: 'D-Link' },
    'cc:b2:55': { vendor: 'D-Link' },
    'f0:7d:68': { vendor: 'D-Link' },
  };

  /**
   * Extract OUI (first 3 octets) from MAC address
   */
  private static extractOUI(macAddress: string): string {
    const normalized = macAddress.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (normalized.length < 6) return '';
    
    // Format as xx:xx:xx
    return [
      normalized.substring(0, 2),
      normalized.substring(2, 4), 
      normalized.substring(4, 6)
    ].join(':');
  }

  /**
   * @deprecated Use HybridMacVendorLookup.lookupVendor() instead
   * Lookup vendor information for a MAC address
   */
  static lookupVendor(macAddress: string): MacVendorInfo {
    if (!macAddress) return {};
    
    const oui = this.extractOUI(macAddress);
    const vendorInfo = this.OUI_DATABASE[oui];
    
    if (vendorInfo) {
      return { ...vendorInfo };
    }

    // If not found in database, try to determine if it's virtual/special
    const normalizedMac = macAddress.toLowerCase();
    
    if (normalizedMac.startsWith('52:54:00')) {
      return { vendor: 'QEMU Virtual NIC' };
    }
    
    if (normalizedMac.startsWith('00:0c:29') || normalizedMac.startsWith('00:50:56')) {
      return { vendor: 'VMware' };
    }
    
    if (normalizedMac.startsWith('08:00:27')) {
      return { vendor: 'Oracle VirtualBox' };
    }
    
    if (normalizedMac.startsWith('00:15:5d')) {
      return { vendor: 'Microsoft Hyper-V' };
    }

    return {};
  }

  /**
   * @deprecated Use HybridMacVendorLookup.isVirtualMac() instead
   * Check if MAC address appears to be virtual/emulated
   */
  static isVirtualMac(macAddress: string): boolean {
    const normalizedMac = macAddress.toLowerCase();
    
    // Known virtual MAC prefixes
    const virtualPrefixes = [
      '52:54:00', // QEMU
      '00:0c:29', // VMware
      '00:50:56', // VMware
      '08:00:27', // VirtualBox
      '00:15:5d', // Hyper-V
      '00:16:3e', // Xen
    ];
    
    return virtualPrefixes.some(prefix => normalizedMac.startsWith(prefix));
  }

  /**
   * @deprecated Use HybridMacVendorLookup.getDeviceType() instead
   * Get a user-friendly device type based on MAC vendor
   */
  static getDeviceType(macAddress: string): string {
    const vendorInfo = this.lookupVendor(macAddress);
    
    if (!vendorInfo.vendor) {
      return 'Unknown Device';
    }
    
    if (this.isVirtualMac(macAddress)) {
      return 'Virtual Machine';
    }
    
    const vendor = vendorInfo.vendor.toLowerCase();
    
    if (vendor.includes('apple')) {
      return 'Apple Device';
    }
    
    if (vendor.includes('samsung')) {
      return 'Samsung Device';
    }
    
    if (vendor.includes('intel')) {
      return 'Intel Device';
    }
    
    if (vendor.includes('nvidia')) {
      return 'Nvidia Device';
    }
    
    if (vendor.includes('google')) {
      return 'Google Device';
    }
    
    if (vendor.includes('amazon')) {
      return 'Amazon Device';
    }
    
    if (vendor.includes('asus')) {
      return 'ASUS Device';
    }
    
    if (vendor.includes('tp-link')) {
      return 'TP-Link Device';
    }
    
    if (vendor.includes('netgear')) {
      return 'Netgear Device';
    }
    
    if (vendor.includes('d-link')) {
      return 'D-Link Device';
    }
    
    return 'Network Device';
  }

  /**
   * @deprecated Use HybridMacVendorLookup.getDeviceInfo() instead
   * Get enhanced device information including vendor and type
   */
  static getDeviceInfo(macAddress: string): MacVendorInfo & { deviceType: string } {
    const vendorInfo = this.lookupVendor(macAddress);
    const deviceType = this.getDeviceType(macAddress);
    
    return {
      ...vendorInfo,
      deviceType
    };
  }
}
