// src/websocket/wizard/firewallHandlers.ts

import { FeatureHandlers } from '../types';
import { execute_argv } from '../../utils/exec';
import { Validators, rejectInvalid } from '../../utils/validators';
import {
  getZonePortForwards, getZoneServices, getZonePorts, getZoneMasquerade, getZoneTarget, parseActiveZones,
} from './firewallZones';
import { applyBoth, ruleOption, Rule, RuleOp } from '../../features/firewall/firewallRules';

// ---- input validation helpers (throw on invalid wizard input) ----

function assertPortInputs(zone: string, port: string, protocol: string): void {
  if (!Validators.isZone(zone)) { rejectInvalid('zone', zone, 'wizard'); throw new Error('Invalid zone parameter'); }
  if (!Validators.isPort(port)) { rejectInvalid('port', port, 'wizard'); throw new Error('Invalid port parameter'); }
  if (!Validators.isProtocol(protocol)) { rejectInvalid('protocol', protocol, 'wizard'); throw new Error('Invalid protocol parameter'); }
}

function assertForwardInputs(zone: string, port: string, protocol: string, toPort: string, toAddr: string): void {
  assertPortInputs(zone, port, protocol);
  if (!Validators.isPort(toPort)) { rejectInvalid('toPort', toPort, 'wizard'); throw new Error('Invalid toPort parameter'); }
  if (!Validators.isIPv4(toAddr)) { rejectInvalid('toAddr', toAddr, 'wizard'); throw new Error('Invalid toAddr parameter'); }
}

type PortParams = { port: string; protocol?: string; zone?: string };
type ForwardParams = { port: string; toAddr: string; toPort: string; protocol?: string; zone?: string };

/** Permanent then runtime, never a live reload (see firewallRules.ts); throws on failure. */
async function applyOrThrow(zone: string, change: { op: RuleOp; rule: Rule }): Promise<void> {
  const outcome = await applyBoth([`--zone=${zone}`, ruleOption(change.op, change.rule)]);
  if (!outcome.ok) throw new Error(`firewall-cmd failed (${outcome.failed}): ${outcome.detail}`);
}

export function createFirewallHandlers(): FeatureHandlers {
  return {
    list_zones: async () => {
      const result = await execute_argv('firewall-cmd', ['--get-zones']);
      if (result.exitCode !== 0) throw new Error('Failed to list zones');
      return result.stdout.trim().split(/\s+/);
    },

    get_zone_details: async (params) => {
      const { zone } = params as { zone: string };
      if (!zone) throw new Error('Missing zone parameter');
      if (!Validators.isZone(zone)) throw new Error('Invalid zone parameter');

      const [forwards, services, ports, masquerade] = await Promise.all([
        getZonePortForwards(zone),
        getZoneServices(zone),
        getZonePorts(zone),
        getZoneMasquerade(zone),
      ]);

      return { zone, forwards, services, ports, masquerade };
    },

    get_rules: async () => {
      const activeZonesOutput = await execute_argv('firewall-cmd', ['--get-active-zones']);
      const zoneInterfaceMap = parseActiveZones(activeZonesOutput.stdout);

      const defaultZoneResult = await execute_argv('firewall-cmd', ['--get-default-zone']);
      const defaultZone = defaultZoneResult.stdout.trim();

      const zones: Array<{
        name: string;
        target: string;
        interfaces: string[];
        services: string[];
        ports: string[];
        masquerade: boolean;
        forward_ports: Array<{ port: string; protocol: string; to_port: string; to_addr: string }>;
      }> = [];

      for (const [zoneName, interfaces] of zoneInterfaceMap) {
        const [forwards, services, ports, masquerade, target] = await Promise.all([
          getZonePortForwards(zoneName),
          getZoneServices(zoneName),
          getZonePorts(zoneName),
          getZoneMasquerade(zoneName),
          getZoneTarget(zoneName),
        ]);

        zones.push({
          name: zoneName,
          target,
          interfaces,
          services,
          ports,
          masquerade,
          forward_ports: forwards.map(f => ({
            port: f.port,
            protocol: f.proto,
            to_port: f.toport,
            to_addr: f.toaddr,
          })),
        });
      }

      return { zones, default_zone: defaultZone };
    },

    add_port: async (params) => {
      const { port, protocol = 'tcp', zone = 'public' } = params as PortParams;
      if (!port) throw new Error('Missing port parameter');
      assertPortInputs(zone, port, protocol);

      await applyOrThrow(zone, { op: 'add', rule: { kind: 'port', port, protocol } });
      return { success: true, port, protocol, zone };
    },

    remove_port: async (params) => {
      const { port, protocol = 'tcp', zone = 'public' } = params as PortParams;
      if (!port) throw new Error('Missing port parameter');
      assertPortInputs(zone, port, protocol);

      await applyOrThrow(zone, { op: 'remove', rule: { kind: 'port', port, protocol } });
      return { success: true, port, protocol, zone };
    },

    add_forward: async (params) => {
      const { port, toAddr, toPort, protocol = 'tcp', zone = 'public' } = params as ForwardParams;
      if (!port || !toAddr || !toPort) throw new Error('Missing port, toAddr or toPort parameter');
      assertForwardInputs(zone, port, protocol, toPort, toAddr);

      await applyOrThrow(zone, { op: 'add', rule: { kind: 'forward', port, protocol, toaddr: toAddr, toport: toPort } });
      return { success: true, port, toAddr, toPort, protocol, zone };
    },

    remove_forward: async (params) => {
      const { port, toAddr, toPort, protocol = 'tcp', zone = 'public' } = params as ForwardParams;
      if (!port || !toAddr || !toPort) throw new Error('Missing port, toAddr or toPort parameter');
      assertForwardInputs(zone, port, protocol, toPort, toAddr);

      await applyOrThrow(zone, { op: 'remove', rule: { kind: 'forward', port, protocol, toaddr: toAddr, toport: toPort } });
      return { success: true, port, toAddr, toPort, protocol, zone };
    },
  };
}
