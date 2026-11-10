// "Network": uplink, guest VPN, PPPoE fallback, then one section per bridge.

import {
  heading, subheading, tile, trendTile, toggleTile, pressTile, entities, row,
  history, markdown, section, view,
} from '../cards.js';
import { devicesTable } from './templates.js';

export function network(m, t) {
  return view('network', t('view.network'), 'mdi:lan', [
    ...m.wan.map((uplink) => wan(uplink, t)),
    guestVpn(m, t),
    pppoe(m, t),
    ...m.bridges.map((b) => bridge(b, t)),
  ]);
}

function wan(uplink, t) {
  const tr = uplink.traffic;
  return section([
    heading(t('section.wan'), 'mdi:wan'),
    history([tr.down, tr.up], { title: t('name.throughput6h'), hours_to_show: 6 }),
    tile(tr.totalDown, { name: t('name.totalDown') }),
    tile(tr.totalUp, { name: t('name.totalUp') }),
    zoneTile(uplink.zoneSelect, t),
  ], { column_span: 2 });
}

function guestVpn(m, t) {
  const v = m.guestVpn;
  return section([
    heading(t('section.guestVpn'), 'mdi:shield-lock-outline'),
    toggleTile(v.switch, { name: t('name.guestVpn') }),
    tile(v.state, { name: t('name.guestVpnState') }),
    tile(v.exitIp, { name: t('name.exitIp') }),
    tile(v.onOrange, { name: t('name.guestsOnUplink') }),
  ]);
}

function pppoe(m, t) {
  const p = m.pppoe;
  return section([
    heading(t('section.pppoe'), 'mdi:phone-classic'),
    markdown(t('help.pppoe')),
    tile(p.connection, { name: t('name.pppoeLink') }),
    tile(p.configFound, { name: t('name.pppoeConfig') }),
    entities([
      row(p.username, t('name.username')),
      row(p.password, t('name.password')),
    ]),
    pressTile(p.save, t('action.saveCredentials'), 'mdi:content-save', t('confirm.pppoeSave')),
    pressTile(p.test, t('action.testConnection'), 'mdi:connection'),
    tile(p.lastAction, { name: t('name.lastAction') }),
  ]);
}

function bridge(b, t) {
  const tr = b.traffic;
  return section([
    heading(t.bridge(b.name), 'mdi:lan'),
    tile(b.info, { name: t('name.subnet'), icon: 'mdi:ip-network' }),
    tile(b.count, { name: t('name.devices'), icon: 'mdi:devices' }),
    zoneTile(b.zoneSelect, t),
    trendTile(tr.down, { name: t('name.download') }, 6),
    trendTile(tr.up, { name: t('name.upload') }, 6),
    b.devices && subheading(t('name.connectedDevices')),
    b.devices && markdown(devicesTable(b.devices, t), { grid_options: { columns: 'full' } }),
  ], { column_span: 2 });
}

/**
 * Zone of an interface. Changing it reloads firewalld, which has cut the LAN
 * before, so the select is not on the card: a tap opens the more-info dialog,
 * where the change is one deliberate step away.
 */
export function zoneTile(select, t, name) {
  return tile(select, { name: name ?? t('name.firewallZone'), icon: 'mdi:shield-half-full' });
}
