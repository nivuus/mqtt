// src/features/firewall/firewallEntities.ts
//
// Home Assistant entities of the firewall feature that follow firewalld's
// state (interfaces, zones): what each one is, never how it is sent (the same
// split as wifi/hostapdEntities.ts). The forms are in firewallFormEntities.ts.

export interface EntitySpec {
  component: 'sensor' | 'binary_sensor' | 'text' | 'select' | 'button';
  objectId: string;
  payload: Record<string, unknown>;
}

type Topic = (path: string) => string;

/** Zone sensor of an interface whose name looks like a NIC (eth, enp, wlp, wlo, ppp). */
export function interfaceZoneSensor(feature: string, topic: Topic, iface: string): EntitySpec[] {
  return [
    { component: 'sensor', objectId: `${iface}_zone`, payload: {
      name: `Network Firewall ${iface} Zone Sensor`,
      state_topic: topic(`${feature}/${iface}/zone/state`),
      icon: 'mdi:security-network',
      entity_category: 'diagnostic' as 'diagnostic',
    } },
  ];
}

/** Select that moves an interface to another zone. */
export function interfaceZoneSelect(feature: string, topic: Topic, iface: string, zones: string[]): EntitySpec[] {
  return [
    { component: 'select', objectId: `${iface}_zone_select`, payload: {
      name: `Network Firewall ${iface} Zone Select`,
      command_topic: topic(`${feature}/${iface}_zone_select/set`),
      state_topic: topic(`${feature}/${iface}_zone_select/state`),
      icon: 'mdi:network',
      entity_category: 'config' as 'config',
      options: zones,
    } },
  ];
}

/** Rule summaries of one zone: forwards, services, ports, masquerade. */
export function zoneEntities(feature: string, topic: Topic, zone: string): EntitySpec[] {
  return [
    { component: 'sensor', objectId: `${zone}_port_forwards`, payload: {
      name: `Network Firewall ${zone} Port Forwards Sensor`,
      state_topic: topic(`${feature}/${zone}/port_forwards/state`),
      icon: 'mdi:arrow-right-bold',
      entity_category: 'diagnostic' as 'diagnostic',
      json_attributes_topic: topic(`${feature}/${zone}/port_forwards/attributes`),
    } },
    { component: 'sensor', objectId: `${zone}_services`, payload: {
      name: `Network Firewall ${zone} Services Sensor`,
      state_topic: topic(`${feature}/${zone}/services/state`),
      icon: 'mdi:cog',
      entity_category: 'diagnostic' as 'diagnostic',
      json_attributes_topic: topic(`${feature}/${zone}/services/attributes`),
    } },
    { component: 'sensor', objectId: `${zone}_ports`, payload: {
      name: `Network Firewall ${zone} Ports Sensor`,
      state_topic: topic(`${feature}/${zone}/ports/state`),
      icon: 'mdi:gate',
      entity_category: 'diagnostic' as 'diagnostic',
      json_attributes_topic: topic(`${feature}/${zone}/ports/attributes`),
    } },
    { component: 'binary_sensor', objectId: `${zone}_masquerade`, payload: {
      name: `Network Firewall ${zone} Masquerade Sensor`,
      state_topic: topic(`${feature}/${zone}/masquerade/state`),
      payload_on: 'ON',
      payload_off: 'OFF',
      icon: 'mdi:incognito',
      entity_category: 'diagnostic' as 'diagnostic',
    } },
  ];
}
