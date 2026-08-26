// simple-test.ts

import { StaticMacVendorLookup } from './src/utils/macVendor/StaticMacVendorLookup';

console.log('Testing static MAC vendor lookup...');

const testMacs = [
  '00:0c:29:12:34:56', // VMware
  '08:00:27:ab:cd:ef', // VirtualBox 
  '00:16:cb:aa:bb:cc', // Apple
  'aa:bb:cc:dd:ee:ff'  // Unknown
];

for (const mac of testMacs) {
  const result = StaticMacVendorLookup.lookupVendor(mac);
  const deviceType = StaticMacVendorLookup.getDeviceType(mac);
  const isVirtual = StaticMacVendorLookup.isVirtualMac(mac);
  
  console.log(`MAC: ${mac}`);
  console.log(`  Vendor: ${result.vendor || 'Unknown'}`);
  console.log(`  Type: ${deviceType}`);
  console.log(`  Virtual: ${isVirtual}`);
  console.log('');
}

console.log('Static lookup test completed!');
