/**
 * The guest VPN's Home Assistant entities and the topics they read and write, relative to the
 * agent's base topic (BaseFeature prefixes them). Names follow CLAUDE.md: no device name,
 * `{Category} {Name} {Type}`.
 */
import { HaDiscoveryPayload } from '../../core/types';
import { GuestVpnState } from './guestVpnStatus';
import { GuestVpnSnapshot } from './guestVpnSupervisor';

export const GUEST_VPN_STATES: GuestVpnState[] = ['connected', 'connecting', 'disabled', 'no_config', 'error'];

/** HA's MQTT sensor, switch and binary_sensor read this payload as "unknown". */
export const PAYLOAD_NONE = 'None';

export function guestVpnTopics(feature: string) {
  return {
    switchState: `${feature}/switch/state`,
    switchSet: `${feature}/switch/set`,
    state: `${feature}/state/state`,
    attributes: `${feature}/state/attributes`,
    exitIp: `${feature}/exit_ip/state`,
    onOrange: `${feature}/on_orange/state`,
  };
}

export interface EntityDefinition {
  component: 'switch' | 'sensor' | 'binary_sensor';
  objectId: string;
  payload: Partial<HaDiscoveryPayload>;
}

export function guestVpnEntities(feature: string): EntityDefinition[] {
  const t = guestVpnTopics(feature);
  return [
    {
      component: 'switch', objectId: 'switch',
      payload: {
        name: 'Network Guest VPN Switch', state_topic: t.switchState, command_topic: t.switchSet,
        payload_on: 'ON', payload_off: 'OFF', state_on: 'ON', state_off: 'OFF', icon: 'mdi:vpn',
      },
    },
    {
      component: 'sensor', objectId: 'state',
      payload: {
        name: 'Network Guest VPN State Sensor', state_topic: t.state, json_attributes_topic: t.attributes,
        device_class: 'enum', options: GUEST_VPN_STATES, icon: 'mdi:shield-lock-outline',
      },
    },
    {
      component: 'sensor', objectId: 'exit_ip',
      payload: { name: 'Network Guest VPN Exit IP Sensor', state_topic: t.exitIp, icon: 'mdi:ip-network-outline' },
    },
    {
      component: 'binary_sensor', objectId: 'on_orange',
      payload: {
        name: 'Network Guest VPN On Orange Sensor', state_topic: t.onOrange,
        payload_on: 'ON', payload_off: 'OFF', icon: 'mdi:shield-off-outline',
      },
    },
  ];
}

/** Topic → payload for one snapshot. Never carries a credential: only NM's state and errors. */
export function snapshotPayloads(feature: string, s: GuestVpnSnapshot): Array<[string, string]> {
  const t = guestVpnTopics(feature);
  const switchState = s.desired === undefined ? PAYLOAD_NONE : s.desired ? 'ON' : 'OFF';
  const attributes = {
    last_error: s.status.lastError ?? null,
    remote: s.status.remote ?? null,
    dns: s.status.dns,
    exit_ip_error: s.status.exitIpError ?? null,
    dns_error: s.dnsError ?? null,
    action_error: s.actionError ?? null,
  };
  return [
    [t.switchState, switchState],
    [t.state, s.status.state],
    [t.attributes, JSON.stringify(attributes)],
    [t.exitIp, s.status.exitIp ?? PAYLOAD_NONE],
    // Guests leave through Orange whenever the tunnel fails its health checks (tunnelHealth.ts).
    [t.onOrange, s.status.state === 'connected' ? 'OFF' : 'ON'],
  ];
}
