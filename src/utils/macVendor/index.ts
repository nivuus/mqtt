// src/utils/macVendor/index.ts
/**
 * MAC address → vendor, resolved offline from the IEEE registry (`ieee-data`). No address
 * ever leaves the host. A locally administered address (bit 0x02 of the first octet: a
 * phone's private Wi-Fi address, a VM's NIC) belongs to no registered vendor and is answered
 * without any lookup.
 */
import { IeeeRegistry } from './ieeeRegistry';

export interface MacVendorInfo {
  vendor?: string;
}

export const LOCALLY_ADMINISTERED_LABEL = 'Randomised or virtual address';

/** The 12 upper-case hex digits of a MAC written with `:`, `-`, `.` or no separator. */
function hexOf(mac: string): string | undefined {
  const hex = mac.replace(/[:.-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(hex) ? hex : undefined;
}

export class MacVendorLookupService {
  constructor(private readonly registry: IeeeRegistry = new IeeeRegistry()) {}

  async lookupVendor(mac: string): Promise<MacVendorInfo> {
    const hex = hexOf(mac);
    if (!hex) return {};
    if (parseInt(hex.slice(0, 2), 16) & 0x02) return { vendor: LOCALLY_ADMINISTERED_LABEL };
    const vendor = await this.registry.organisationOf(hex);
    return vendor ? { vendor } : {};
  }

  async batchLookup(macs: string[]): Promise<Map<string, MacVendorInfo>> {
    const results = new Map<string, MacVendorInfo>();
    for (const mac of macs) {
      const info = await this.lookupVendor(mac);
      if (info.vendor) results.set(mac, info);
    }
    return results;
  }
}

/** The agent's lookup, on the system registry. */
export const MacVendorLookup = new MacVendorLookupService();
