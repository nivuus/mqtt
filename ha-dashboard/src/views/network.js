// "Network": throughput, every interface in one table, guest VPN, PPPoE
// fallback, then the clients of each bridge.

import { list, row, buttonRow, table, history, markdown, section, view, formCard } from '../cards.js';
import { devicesTable } from './templates.js';

export function network(m, t) {
  const uplink = m.wan[0];
  return view('network', t('view.network'), [
    section([
      uplink && history([uplink.traffic.down, uplink.traffic.up], { title: t('name.throughput6h'), hours_to_show: 6 }),
      interfaces(m, t),
    ], { column_span: 2 }),
    section([guestVpn(m, t)]),
    section(pppoe(m, t)),
    ...m.bridges.map((b) => section([
      markdown(devicesTable(b.devices, t), {
        title: t('name.devicesOn', { bridge: t.bridge(b.name) }), grid_options: { columns: 'full' },
      }),
    ], { column_span: 2 })),
  ], { max_columns: 2 });
}

/**
 * One row per interface firewalld knows. A click opens the zone select's
 * more-info dialog: changing a zone reloads firewalld, which has cut the LAN
 * before, so it stays one deliberate step away.
 */
function interfaces(m, t) {
  const bridges = new Map(m.bridges.map((b) => [b.name.toLowerCase(), b]));
  const rows = m.interfaces.map((i) => {
    const b = bridges.get(i.name.toLowerCase());
    const tr = i.traffic;
    return {
      entity: i.zoneSelect,
      cells: {
        name: { text: t.iface(i.name) },
        subnet: b ? { entity: b.info } : { text: '—' },
        zone: { entity: i.zoneSelect },
        devices: b ? { entity: b.count, numeric: true } : { text: '' },
        down: tr.down ? { entity: tr.down, numeric: true } : { text: '' },
        up: tr.up ? { entity: tr.up, numeric: true } : { text: '' },
        total: tr.totalDown ? { entity: tr.totalDown, numeric: true, muted: true } : { text: '' },
      },
    };
  });
  return table(t('section.interfaces'), 'mdi:ethernet', [
    { key: 'name', label: t('col.interface'), sortable: true },
    { key: 'subnet', label: t('col.subnet') },
    { key: 'zone', label: t('col.zone'), sortable: true },
    { key: 'devices', label: t('col.devices'), sortable: true, align: 'end' },
    { key: 'down', label: t('name.download'), sortable: true, align: 'end' },
    { key: 'up', label: t('name.upload'), sortable: true, align: 'end' },
    { key: 'total', label: t('name.totalDown'), sortable: true, align: 'end' },
  ], rows);
}

function guestVpn(m, t) {
  const v = m.guestVpn;
  return list(t('section.guestVpn'), 'mdi:shield-lock-outline', [
    row(v.switch, t('name.guestVpn')),
    row(v.state, t('name.guestVpnState')),
    row(v.exitIp, t('name.exitIp')),
    row(v.onOrange, t('name.guestsOnUplink')),
  ]);
}

function pppoe(m, t) {
  const p = m.pppoe;
  return [
    list(t('section.pppoe'), 'mdi:phone-classic', [
      row(p.connection, t('name.pppoeLink')),
      row(p.configFound, t('name.pppoeConfig')),
      { type: 'text', icon: 'mdi:information-outline', name: t('name.about'), text: t('help.pppoeShort') },
    ]),
    formCard(t('section.pppoeCredentials'), 'mdi:account-key', {
      mode: 'edit',
      fields: [
        { entity: p.username, label: t('name.username'), required: true },
        { entity: p.password, label: t('name.password'), required: true },
      ],
      submit: { entity: p.save, label: t('action.save'), icon: 'mdi:content-save', confirm: t('confirm.pppoeSave') },
      extra: [{ entity: p.test, label: t('action.testConnection'), icon: 'mdi:connection' }],
      status: p.lastAction,
    }),
  ];
}
