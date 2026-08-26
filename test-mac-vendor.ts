// test-mac-vendor.ts

import { MacVendorLookup } from './src/utils/macVendor';

async function testMacVendorLookup() {
  console.log('Testing MAC Vendor Lookup...\n');
  
  const testMacs = [
    '00:0c:29:12:34:56', // VMware
    '08:00:27:ab:cd:ef', // VirtualBox 
    '00:16:cb:aa:bb:cc', // Apple
    '00:15:5d:dd:ee:ff', // Microsoft
    '52:54:00:12:34:56', // QEMU
    'aa:bb:cc:dd:ee:ff'  // Unknown
  ];

  console.log('=== Individual Lookups ===');
  for (const mac of testMacs) {
    try {
      const result = await MacVendorLookup.lookupVendor(mac);
      const deviceType = await MacVendorLookup.getDeviceType(mac);
      const isVirtual = MacVendorLookup.isVirtualMac(mac);
      
      console.log(`MAC: ${mac}`);
      console.log(`  Vendor: ${result.vendor || 'Unknown'}`);
      console.log(`  Type: ${deviceType}`);
      console.log(`  Virtual: ${isVirtual}`);
      console.log('');
    } catch (error) {
      console.error(`Error looking up ${mac}:`, error);
    }
  }

  console.log('=== Batch Lookup ===');
  try {
    const batchResults = await MacVendorLookup.batchLookup(testMacs);
    for (const [mac, result] of batchResults) {
      console.log(`${mac}: ${result.vendor || 'Unknown'}`);
    }
  } catch (error) {
    console.error('Batch lookup error:', error);
  }

  console.log('\n=== Cache Stats ===');
  try {
    const stats = await MacVendorLookup.getCacheStats();
    console.log(`Total entries: ${stats.entries}`);
    console.log(`Valid entries: ${stats.validEntries}`);
    console.log(`Expired entries: ${stats.expiredEntries}`);
  } catch (error) {
    console.error('Cache stats error:', error);
  }
}

testMacVendorLookup().catch(console.error);
