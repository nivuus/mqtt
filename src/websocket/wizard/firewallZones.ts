// src/websocket/wizard/firewallZones.ts
//
// Read-only firewalld zone queries used by the firewall wizard handlers. Every
// zone passed in has already been validated (or comes from firewalld itself).

import { execute_argv } from '../../utils/exec';

export interface ZonePortForward {
  port: string;
  proto: string;
  toport: string;
  toaddr: string;
}

export async function getZonePortForwards(zone: string): Promise<ZonePortForward[]> {
  const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-forward-ports']);
  if (result.exitCode !== 0) return [];

  const forwards: ZonePortForward[] = [];
  const lines = result.stdout.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/port=(\d+):proto=(tcp|udp):toport=(\d+):toaddr=([\d.]+)/);
    if (match) {
      forwards.push({ port: match[1], proto: match[2], toport: match[3], toaddr: match[4] });
    }
  }
  return forwards;
}

export async function getZoneServices(zone: string): Promise<string[]> {
  const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-services']);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(s => s.length > 0);
}

export async function getZonePorts(zone: string): Promise<string[]> {
  const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--list-ports']);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(p => p.length > 0);
}

export { zoneMasquerade as getZoneMasquerade } from '../../features/firewall/firewallQueries';

export async function getZoneTarget(zone: string): Promise<string> {
  const result = await execute_argv('firewall-cmd', [`--zone=${zone}`, '--get-target']);
  return result.exitCode === 0 ? result.stdout.trim() : 'default';
}

/** Parse `firewall-cmd --get-active-zones` into zone -> interfaces. */
export function parseActiveZones(output: string): Map<string, string[]> {
  const zoneInterfaceMap = new Map<string, string[]>();
  if (!output) return zoneInterfaceMap;

  const lines = output.split('\n');
  let currentZone: string | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (line.match(/^\S/) && !trimmedLine.startsWith('interfaces:') && !trimmedLine.startsWith('sources:')) {
      currentZone = trimmedLine.split(':')[0].trim();
      if (!zoneInterfaceMap.has(currentZone)) {
        zoneInterfaceMap.set(currentZone, []);
      }
    } else if (currentZone && trimmedLine.startsWith('interfaces:')) {
      const interfaces = trimmedLine.substring('interfaces:'.length).trim().split(/\s+/).filter(i => i.length > 0);
      const existing = zoneInterfaceMap.get(currentZone) || [];
      zoneInterfaceMap.set(currentZone, [...existing, ...interfaces]);
    }
  }

  return zoneInterfaceMap;
}
