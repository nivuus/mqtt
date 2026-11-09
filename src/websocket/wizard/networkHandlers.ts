// src/websocket/wizard/networkHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators } from '../../utils/validators';

export function createNetworkHandlers(): FeatureHandlers {
  return {
    get_interfaces: async () => {
      const linkResult = await execute_argv('ip', ['-j', 'link', 'show']);
      if (linkResult.exitCode !== 0) throw new Error('Failed to get interfaces');

      const addrResult = await execute_argv('ip', ['-j', 'addr', 'show']);
      const addresses = addrResult.exitCode === 0 ? JSON.parse(addrResult.stdout) : [];

      // Get firewall zones for interfaces
      const zonesResult = await execute_argv('firewall-cmd', ['--get-active-zones']);
      const zoneMap = new Map<string, string>();
      if (zonesResult.exitCode === 0) {
        let currentZone = '';
        for (const line of zonesResult.stdout.split('\n')) {
          if (!line.startsWith(' ') && !line.startsWith('\t') && line.trim()) {
            currentZone = line.replace(':', '').trim();
          } else if (line.includes('interfaces:')) {
            const ifaces = line.replace('interfaces:', '').trim().split(/\s+/);
            for (const iface of ifaces) {
              if (iface) zoneMap.set(iface, currentZone);
            }
          }
        }
      }

      // Get network stats
      const statsResult = await execute_argv('cat', ['/proc/net/dev']);
      const statsMap = new Map<string, { rx_bytes: number; tx_bytes: number }>();
      if (statsResult.exitCode === 0) {
        for (const line of statsResult.stdout.split('\n').slice(2)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            const ifaceName = parts[0].replace(':', '');
            statsMap.set(ifaceName, {
              rx_bytes: parseInt(parts[1]) || 0,
              tx_bytes: parseInt(parts[9]) || 0,
            });
          }
        }
      }

      const linkInterfaces = JSON.parse(linkResult.stdout);
      return linkInterfaces
        .filter((iface: any) => !['lo'].includes(iface.ifname) && !iface.ifname.startsWith('veth') && !iface.ifname.startsWith('vnet'))
        .map((iface: any) => {
          const addrInfo = addresses.find((a: any) => a.ifname === iface.ifname);
          const ipv4 = addrInfo?.addr_info?.find((a: any) => a.family === 'inet');
          const stats = statsMap.get(iface.ifname);

          // Determine interface type
          let type = 'ethernet';
          if (iface.ifname.includes('Bridge') || iface.ifname.startsWith('br')) type = 'bridge';
          else if (iface.ifname.startsWith('wl')) type = 'wifi';
          else if (iface.ifname.startsWith('ppp')) type = 'ppp';
          else if (iface.ifname.includes('.')) type = 'vlan';
          else if (iface.ifname.startsWith('docker') || iface.ifname.startsWith('veth')) type = 'virtual';

          return {
            name: iface.ifname,
            type,
            state: iface.operstate?.toLowerCase() || 'unknown',
            mac_address: iface.address,
            ip_address: ipv4?.local,
            mtu: iface.mtu,
            rx_bytes: stats?.rx_bytes || 0,
            tx_bytes: stats?.tx_bytes || 0,
            zone: zoneMap.get(iface.ifname),
          };
        });
    },

    get_zones: async () => {
      const result = await execute_argv('firewall-cmd', ['--get-zones']);
      if (result.exitCode !== 0) throw new Error('Failed to get zones');
      return result.stdout.trim().split(/\s+/);
    },

    set_interface_zone: async (params) => {
      const { interface: iface, zone, currentZone } = params as { interface: string; zone: string; currentZone?: string };
      if (!iface || !zone) throw new Error('Missing interface or zone parameter');
      // Validate wizard-controlled input before it reaches firewall-cmd.
      if (!Validators.isInterface(iface)) throw new Error('Invalid interface parameter');
      if (!Validators.isZone(zone)) throw new Error('Invalid zone parameter');
      if (currentZone && !Validators.isZone(currentZone)) throw new Error('Invalid currentZone parameter');

      // Remove from current zone if specified
      if (currentZone) {
        await execute_argv('firewall-cmd', [`--zone=${currentZone}`, `--remove-interface=${iface}`, '--permanent']);
      }

      // Add to new zone
      const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, `--add-interface=${iface}`, '--permanent']);
      if (result.exitCode !== 0) throw new Error(`Failed to add interface to zone: ${result.stderr}`);

      // Reload firewall
      await execute_argv('firewall-cmd', ['--reload']);

      return { success: true, interface: iface, zone };
    },

    get_status: async () => {
      const activeZones = await execute_argv('firewall-cmd', ['--get-active-zones']);
      return { activeZones: activeZones.stdout };
    },
  };
}
