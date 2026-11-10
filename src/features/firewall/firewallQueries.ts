// src/features/firewall/firewallQueries.ts
//
// Read-only questions to firewalld (firewall-cmd), and the parser of its
// active-zones listing. Nothing here changes the firewall.

import { execute_argv } from '../../utils/exec';
import logger from '../../utils/logger';

// Helper: Get port forwards for a specific zone
export async function zonePortForwards(zone: string): Promise<Array<{port: string, proto: string, toport: string, toaddr: string}>> {
  try {
    const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-forward-ports']);
    if (result.exitCode !== 0) return [];

    const forwards: Array<{port: string, proto: string, toport: string, toaddr: string}> = [];
    const lines = result.stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      // Format: port=3389:proto=tcp:toport=3389:toaddr=192.168.3.2
      const match = line.match(/port=(\d+):proto=(tcp|udp):toport=(\d+):toaddr=([\d.]+)/);
      if (match) {
        forwards.push({
          port: match[1],
          proto: match[2],
          toport: match[3],
          toaddr: match[4]
        });
      }
    }
    return forwards;
  } catch (error) {
    logger.error(`Error getting port forwards for zone ${zone}:`, error);
    return [];
  }
}

// Helper: Get services in a zone
export async function zoneServices(zone: string): Promise<string[]> {
  try {
    const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-services']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split(/\s+/).filter(s => s.length > 0);
  } catch (error) {
    logger.error(`Error getting services for zone ${zone}:`, error);
    return [];
  }
}

// Helper: Get ports in a zone
export async function zonePorts(zone: string): Promise<string[]> {
  try {
    const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-ports']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split(/\s+/).filter(p => p.length > 0);
  } catch (error) {
    logger.error(`Error getting ports for zone ${zone}:`, error);
    return [];
  }
}

// Helper: Check if masquerading is enabled in a zone
export async function zoneMasquerade(zone: string): Promise<boolean> {
  try {
    const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--query-masquerade']);
    return result.exitCode === 0; // Exit code 0 means yes, 1 means no
  } catch (error) {
    logger.error(`Error querying masquerade for zone ${zone}:`, error);
    return false;
  }
}

export function parseActiveZones(output: string): Map<string, string[]> {
  const zoneInterfaceMap = new Map<string, string[]>();
  if (!output || typeof output !== 'string') return zoneInterfaceMap;

  const lines = output.split('\n');
  let currentZone: string | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue; // Skip empty lines

    // Check if the line is a zone name (does not start with whitespace)
    if (line.match(/^\S/) && !trimmedLine.startsWith('interfaces:') && !trimmedLine.startsWith('sources:')) {
      // It's a zone name. It might or might not have interfaces on the same line.
      const parts = trimmedLine.split(':');
      // firewalld >= 2.x (Debian Trixie) appends " (default)" to the default
      // zone in `--get-active-zones`; strip it or every firewall-cmd call for
      // that zone fails with INVALID_ZONE (the internal zone went unmonitored).
      currentZone = parts[0].trim().replace(/\s*\(default\)\s*$/, '');
      if (parts.length > 1 && parts[1].trim()) {
        // Interfaces are on the same line as the zone
        const interfaces = parts[1].trim().split(/\s+/).filter(iface => iface.length > 0);
        if (interfaces.length > 0) {
          zoneInterfaceMap.set(currentZone, (zoneInterfaceMap.get(currentZone) || []).concat(interfaces));
        }
      } else {
        // Interfaces might be on the next line(s), set currentZone and wait for 'interfaces:'
        // If this zone doesn't have an explicit interfaces line, it might be an empty zone or just sources.
        // Ensure the zone is added even if no interfaces are listed immediately,
        // in case they appear on a following "interfaces:" line.
        if (!zoneInterfaceMap.has(currentZone)) {
          zoneInterfaceMap.set(currentZone, []);
        }
      }
    } else if (currentZone && trimmedLine.startsWith('interfaces:')) {
      // Interfaces for the currentZone
      const interfaces = trimmedLine.substring('interfaces:'.length).trim().split(/\s+/).filter(iface => iface.length > 0);
      if (interfaces.length > 0) {
        zoneInterfaceMap.set(currentZone, (zoneInterfaceMap.get(currentZone) || []).concat(interfaces));
      }
    } else if (currentZone && trimmedLine.startsWith('sources:')) {
      // Sources for the currentZone, ignore for now or handle if needed later
    }
    // If line doesn't match any known pattern and a currentZone is active,
    // it might be a continuation or something else. For now, this parser is simple.
  }
  
  // Clean up zones that were added but ended up with no interfaces
  for (const [zone, interfaces] of zoneInterfaceMap.entries()) {
      if (interfaces.length === 0) {
          zoneInterfaceMap.delete(zone);
      }
  }
  return zoneInterfaceMap;
}
