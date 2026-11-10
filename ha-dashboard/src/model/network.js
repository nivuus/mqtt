// Network side of the model: interfaces, bridges, WAN, firewall, Wi-Fi.

import { naturalCompare } from './lookup.js';

const FW = 'firewalld_manager';
// Zone selects that belong to the rule forms, not to an interface.
const FORM_SELECTS = new Set(['forward']);

export function traffic(q, iface) {
  return {
    down: q.id(`network_stats_${iface}_download_speed`),
    up: q.id(`network_stats_${iface}_upload_speed`),
    totalDown: q.id(`network_stats_${iface}_total_downloaded`),
    totalUp: q.id(`network_stats_${iface}_total_uploaded`),
  };
}

/** Interfaces firewalld knows, with the select that moves them between zones. */
export function interfaces(q) {
  return q.all(`${FW}_(.+)_zone_select`)
    .filter(({ match }) => !FORM_SELECTS.has(match[1]))
    .map(({ match, entityId }) => ({
      name: match[1],
      zoneSelect: entityId,
      zone: q.state(entityId)?.state,
      traffic: traffic(q, match[1]),
    }))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function bridges(q, ifaces) {
  return q.all('connected_devices_(.+)_bridge_info')
    .map(({ match, entityId }) => {
      const name = match[1];
      const iface = ifaces.find((i) => i.name.toLowerCase() === name.toLowerCase());
      return {
        name,
        info: entityId,
        devices: q.id(`connected_devices_${name}_devices`),
        count: q.id(`connected_devices_${name}_device_count`),
        zoneSelect: iface?.zoneSelect,
        zone: iface?.zone,
        traffic: traffic(q, name),
      };
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function pppoe(q) {
  const connection = q.id('pppoe_credentials_connection_status');
  return {
    connection,
    iface: q.attr(connection, 'interface'),
    username: q.id('pppoe_credentials_username_input'),
    password: q.id('pppoe_credentials_password_input'),
    save: q.id('pppoe_credentials_save_credentials_btn'),
    test: q.id('pppoe_credentials_test_connection_btn'),
    configFound: q.id('pppoe_credentials_config_found'),
    lastAction: q.id('pppoe_credentials_last_action'),
  };
}

/**
 * Uplinks are the interfaces firewalld puts in the `external` zone, minus
 * the PPPoE link, which is the fallback uplink and has its own section.
 */
export function wan(ifaces, ppp) {
  return ifaces.filter((i) => i.zone === 'external' && i.name !== ppp.iface);
}

export function guestVpn(q) {
  return {
    switch: q.id('guest_vpn_switch'),
    state: q.id('guest_vpn_state'),
    exitIp: q.id('guest_vpn_exit_ip'),
    onOrange: q.id('guest_vpn_on_orange'),
  };
}

export function firewall(q, ifaces) {
  const zones = q.all(`${FW}_(.+)_services`)
    .map(({ match }) => {
      const zone = match[1];
      const services = q.id(`${FW}_${zone}_services`);
      const ports = q.id(`${FW}_${zone}_ports`);
      const forwards = q.id(`${FW}_${zone}_port_forwards`);
      // Each of these sensors states how many entries its list holds.
      const ruleCount = [services, ports, forwards]
        .map((e) => Number(q.state(e)?.state))
        .filter(Number.isFinite)
        .reduce((a, b) => a + b, 0);
      return {
        name: zone,
        services,
        ports,
        forwards,
        ruleCount,
        masquerade: q.id(`${FW}_${zone}_masquerade`),
        interfaces: ifaces.filter((i) => i.zone === zone).map((i) => i.name),
      };
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
  return {
    zones,
    interfaces: ifaces,
    lastAction: q.id(`${FW}_last_action`),
    activeZones: q.id(`${FW}_active_zones_summary`),
    portForm: {
      port: q.id(`${FW}_port_input`),
      service: q.id(`${FW}_service_input`),
      protocol: q.id(`${FW}_protocol_select`),
      zone: q.id(`${FW}_zone_select`),
      addPort: q.id(`${FW}_add_port_btn`),
      removePort: q.id(`${FW}_remove_port_btn`),
      addService: q.id(`${FW}_add_service_btn`),
      removeService: q.id(`${FW}_remove_service_btn`),
    },
    forwardForm: {
      port: q.id(`${FW}_forward_port_input`),
      toAddress: q.id(`${FW}_forward_toaddr_input`),
      toPort: q.id(`${FW}_forward_toport_input`),
      protocol: q.id(`${FW}_forward_protocol_select`),
      zone: q.id(`${FW}_forward_zone_select`),
      add: q.id(`${FW}_add_forward_btn`),
      remove: q.id(`${FW}_remove_forward_btn`),
    },
  };
}

export function wifi(q) {
  const HM = 'hostapd_manager';
  const summary = q.id(`${HM}_ssids_summary`);
  const listed = q.attr(summary, 'list') ?? [];
  const networks = q.all(`${HM}_network_(\\d+)_name`)
    .map(({ match, entityId }) => {
      const n = match[1];
      const ssid = q.state(entityId)?.state;
      return {
        n: Number(n),
        ssid: entityId,
        password: q.id(`${HM}_network_${n}_password`),
        security: q.id(`${HM}_network_${n}_security`),
        status: q.id(`${HM}_network_${n}_status`),
        apply: q.id(`${HM}_network_${n}_apply`),
        delete: q.id(`${HM}_network_${n}_delete`),
        label: ssid,
        bridge: listed.find((l) => l.name === ssid)?.bridge,
      };
    })
    .sort((a, b) => a.n - b.n);
  return {
    summary,
    networks,
    lastAction: q.id(`${HM}_last_action`),
    reload: q.id(`${HM}_reload_hostapd_btn`),
    newNetwork: {
      ssid: q.id(`${HM}_new_ssid_input`),
      password: q.id(`${HM}_new_password_input`),
      security: q.id(`${HM}_new_security_select`),
      bridge: q.id(`${HM}_new_bridge_select`),
      add: q.id(`${HM}_add_hotspot_btn`),
    },
  };
}
