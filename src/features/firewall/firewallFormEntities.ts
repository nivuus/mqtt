// src/features/firewall/firewallFormEntities.ts
//
// Home Assistant entities of the firewall forms: the summary sensors, the
// open-a-port-or-service form and the port-forward form.

import { EntitySpec } from './firewallEntities';

type Topic = (path: string) => string;

/** Summary sensors and the open-a-port-or-service form. */
export function controlEntities(feature: string, topic: Topic, zones: string[]): EntitySpec[] {
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
      icon: 'mdi:shield-sync',
      entity_category: 'diagnostic' as 'diagnostic',
    } },
    { component: 'text', objectId: 'port_input', payload: {
      name: `Network Firewall Port Input`,
      command_topic: topic(`${feature}/port_input/set`),
      state_topic: topic(`${feature}/port_input/state`),
      icon: 'mdi:ethernet-cable',
      entity_category: 'config' as 'config',
      pattern: '^([0-9]{1,5})?$' /* empty = cleared field */,
      mode: 'text',
    } },
    { component: 'select', objectId: 'protocol_select', payload: {
      name: `Network Firewall Protocol Select`,
      command_topic: topic(`${feature}/protocol_select/set`),
      state_topic: topic(`${feature}/protocol_select/state`),
      icon: 'mdi:protocol',
      entity_category: 'config' as 'config',
      options: ['tcp', 'udp'],
    } },
    { component: 'select', objectId: 'zone_select', payload: {
      name: `Network Firewall Zone Select`,
      command_topic: topic(`${feature}/zone_select/set`),
      state_topic: topic(`${feature}/zone_select/state`),
      icon: 'mdi:shield',
      entity_category: 'config' as 'config',
      options: zones,
    } },
    { component: 'text', objectId: 'service_input', payload: {
      name: `Network Firewall Service Input`,
      command_topic: topic(`${feature}/service_input/set`),
      state_topic: topic(`${feature}/service_input/state`),
      icon: 'mdi:cog',
      entity_category: 'config' as 'config',
      mode: 'text',
    } },
    { component: 'button', objectId: 'add_port_btn', payload: {
      name: `Network Firewall Add Port Button`,
      command_topic: topic(`${feature}/command/add_port`),
      payload_press: 'ADD_PORT',
      icon: 'mdi:plus-circle',
      entity_category: 'config' as 'config',
    } },
    { component: 'button', objectId: 'remove_port_btn', payload: {
      name: `Network Firewall Remove Port Button`,
      command_topic: topic(`${feature}/command/remove_port`),
      payload_press: 'REMOVE_PORT',
      icon: 'mdi:minus-circle',
      entity_category: 'config' as 'config',
    } },
    { component: 'button', objectId: 'add_service_btn', payload: {
      name: `Network Firewall Add Service Button`,
      command_topic: topic(`${feature}/command/add_service`),
      payload_press: 'ADD_SERVICE',
      icon: 'mdi:plus-box',
      entity_category: 'config' as 'config',
    } },
    { component: 'button', objectId: 'remove_service_btn', payload: {
      name: `Network Firewall Remove Service Button`,
      command_topic: topic(`${feature}/command/remove_service`),
      payload_press: 'REMOVE_SERVICE',
      icon: 'mdi:minus-box',
      entity_category: 'config' as 'config',
    } },
  ];
}

/** The port-forward form. */
export function forwardEntities(feature: string, topic: Topic, zones: string[]): EntitySpec[] {
  return [
    { component: 'text', objectId: 'forward_port_input', payload: {
      name: `Network Firewall Forward Port Input`,
      command_topic: topic(`${feature}/forward_port_input/set`),
      state_topic: topic(`${feature}/forward_port_input/state`),
      icon: 'mdi:ethernet',
      entity_category: 'config' as 'config',
      pattern: '^([0-9]{1,5})?$' /* empty = cleared field */,
      mode: 'text',
    } },
    { component: 'text', objectId: 'forward_toaddr_input', payload: {
      name: `Network Firewall Forward To Address Input`,
      command_topic: topic(`${feature}/forward_toaddr_input/set`),
      state_topic: topic(`${feature}/forward_toaddr_input/state`),
      icon: 'mdi:ip',
      entity_category: 'config' as 'config',
      mode: 'text',
    } },
    { component: 'text', objectId: 'forward_toport_input', payload: {
      name: `Network Firewall Forward To Port Input`,
      command_topic: topic(`${feature}/forward_toport_input/set`),
      state_topic: topic(`${feature}/forward_toport_input/state`),
      icon: 'mdi:ethernet',
      entity_category: 'config' as 'config',
      pattern: '^([0-9]{1,5})?$' /* empty = cleared field */,
      mode: 'text',
    } },
    { component: 'select', objectId: 'forward_protocol_select', payload: {
      name: `Network Firewall Forward Protocol Select`,
      command_topic: topic(`${feature}/forward_protocol_select/set`),
      state_topic: topic(`${feature}/forward_protocol_select/state`),
      icon: 'mdi:protocol',
      entity_category: 'config' as 'config',
      options: ['tcp', 'udp'],
    } },
    { component: 'select', objectId: 'forward_zone_select', payload: {
      name: `Network Firewall Forward Zone Select`,
      command_topic: topic(`${feature}/forward_zone_select/set`),
      state_topic: topic(`${feature}/forward_zone_select/state`),
      icon: 'mdi:shield',
      entity_category: 'config' as 'config',
      options: zones,
    } },
    { component: 'button', objectId: 'add_forward_btn', payload: {
      name: `Network Firewall Add Forward Button`,
      command_topic: topic(`${feature}/command/add_forward`),
      payload_press: 'ADD_FORWARD',
      icon: 'mdi:arrow-right-bold-circle',
      entity_category: 'config' as 'config',
    } },
    { component: 'button', objectId: 'remove_forward_btn', payload: {
      name: `Network Firewall Remove Forward Button`,
      command_topic: topic(`${feature}/command/remove_forward`),
      payload_press: 'REMOVE_FORWARD',
      icon: 'mdi:arrow-left-bold-circle',
      entity_category: 'config' as 'config',
    } },
  ];
}
