// src/features/firewall/firewallFormEntities.ts
//
// Home Assistant entities of the firewall's controls: the summary sensors.
// Rules are changed through the JSON command topic `rule/set`, whose address
// the last-action sensor carries (see firewallRules.ts).

import { EntitySpec } from './firewallEntities';

type Topic = (path: string) => string;

/** Summary sensors. */
export function controlEntities(feature: string, topic: Topic): EntitySpec[] {
  return [
    { component: 'sensor', objectId: 'active_zones_summary', payload: {
      name: `Network Firewall Active Zones Sensor`,
      state_topic: topic(`${feature}/active_zones/state`), // Could be count of zones or a summary string
      icon: 'mdi:shield-check',
      entity_category: 'diagnostic' as 'diagnostic',
      json_attributes_topic: topic(`${feature}/active_zones/attributes`),
    } },
    { component: 'sensor', objectId: 'last_action', payload: {
      name: `Network Firewall Last Action Sensor`,
      state_topic: topic(`${feature}/last_action/state`),
      json_attributes_topic: topic(`${feature}/last_action/attributes`),
      icon: 'mdi:shield-sync',
      entity_category: 'diagnostic' as 'diagnostic',
    } },
  ];
}

/**
 * The global port/service and port-forward forms, retired on 2026-11-10 for
 * per-zone editing. Their discovery is withdrawn so Home Assistant drops them.
 */
export const RETIRED_FORM_ENTITIES: ReadonlyArray<[string, string]> = [
  ['text', 'port_input'], ['select', 'protocol_select'], ['select', 'zone_select'], ['text', 'service_input'],
  ['button', 'add_port_btn'], ['button', 'remove_port_btn'], ['button', 'add_service_btn'], ['button', 'remove_service_btn'],
  ['text', 'forward_port_input'], ['text', 'forward_toaddr_input'], ['text', 'forward_toport_input'],
  ['select', 'forward_protocol_select'], ['select', 'forward_zone_select'],
  ['button', 'add_forward_btn'], ['button', 'remove_forward_btn'],
];
