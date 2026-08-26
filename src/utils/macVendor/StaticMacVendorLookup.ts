// src/utils/macVendor/StaticMacVendorLookup.ts

export interface MacVendorInfo {
  vendor?: string;
  model?: string;
}

/**
 * Static MAC vendor lookup using built-in OUI prefixes
 * Used as fallback when online lookup fails
 */
export class StaticMacVendorLookup {
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

    // Apple devices (selection of most common)
    '00:03:93': { vendor: 'Apple' },
    '00:0a:95': { vendor: 'Apple' },
    '00:11:24': { vendor: 'Apple' },
    '00:14:51': { vendor: 'Apple' },
    '00:16:cb': { vendor: 'Apple' },
    '00:17:f2': { vendor: 'Apple' },
    '04:0c:ce': { vendor: 'Apple' },
    '04:1e:64': { vendor: 'Apple' },
    '08:74:02': { vendor: 'Apple' },
    '0c:3e:9f': { vendor: 'Apple' },
    '10:40:f3': { vendor: 'Apple' },
    '14:10:9f': { vendor: 'Apple' },
    '18:af:61': { vendor: 'Apple' },
    '1c:1a:c0': { vendor: 'Apple' },
    '20:78:f0': { vendor: 'Apple' },
    '24:a0:74': { vendor: 'Apple' },
    '28:37:37': { vendor: 'Apple' },
    '2c:1f:23': { vendor: 'Apple' },
    '30:90:ab': { vendor: 'Apple' },
    '34:15:9e': { vendor: 'Apple' },

    // Samsung devices (selection)
    '00:12:fb': { vendor: 'Samsung' },
    '00:16:32': { vendor: 'Samsung' },
    '00:17:c9': { vendor: 'Samsung' },
    '08:37:3d': { vendor: 'Samsung' },
    '0c:14:20': { vendor: 'Samsung' },
    '14:7f:c2': { vendor: 'Samsung' },
    '18:3a:2d': { vendor: 'Samsung' },
    '24:4b:03': { vendor: 'Samsung' },
    '28:ba:b5': { vendor: 'Samsung' },
    '34:23:87': { vendor: 'Samsung' },
    '38:aa:3c': { vendor: 'Samsung' },
    '44:4e:6d': { vendor: 'Samsung' },
    '54:88:0e': { vendor: 'Samsung' },
    '68:eb:c5': { vendor: 'Samsung' },
    '78:1f:db': { vendor: 'Samsung' },
    '88:32:9b': { vendor: 'Samsung' },
    '9c:02:98': { vendor: 'Samsung' },
    'a0:0b:ba': { vendor: 'Samsung' },
    'b8:5e:7b': { vendor: 'Samsung' },
    'e8:50:8b': { vendor: 'Samsung' },

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

    // Common router brands
    '00:13:46': { vendor: 'TP-Link' },
    '14:cc:20': { vendor: 'TP-Link' },
    '2c:30:33': { vendor: 'TP-Link' },
    '50:c7:bf': { vendor: 'TP-Link' },
    '84:16:f9': { vendor: 'TP-Link' },
    'c0:25:e9': { vendor: 'TP-Link' },

    '00:09:5b': { vendor: 'Netgear' },
    '00:0f:b5': { vendor: 'Netgear' },
    '20:4e:7f': { vendor: 'Netgear' },
    '28:c6:8e': { vendor: 'Netgear' },
    '84:1b:5e': { vendor: 'Netgear' },
    'a0:04:60': { vendor: 'Netgear' },

    '00:05:5d': { vendor: 'D-Link' },
    '00:15:e9': { vendor: 'D-Link' },
    '14:d6:4d': { vendor: 'D-Link' },
    '28:10:7b': { vendor: 'D-Link' },
    '84:c9:b2': { vendor: 'D-Link' },
    'c0:a0:bb': { vendor: 'D-Link' },

    '00:15:f2': { vendor: 'ASUS' },
    '00:1e:8c': { vendor: 'ASUS' },
    '08:60:6e': { vendor: 'ASUS' },
    '30:5a:3a': { vendor: 'ASUS' },
    '70:4d:7b': { vendor: 'ASUS' },
    'ac:9e:17': { vendor: 'ASUS' },
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
    
    return 'Network Device';
  }
}
