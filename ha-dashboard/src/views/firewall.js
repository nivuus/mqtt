// "Firewall": status, where each interface sits, each zone's rules, the forms.

import { list, row, buttonRow, table, markdown, section, view } from '../cards.js';
import { zoneRules } from './templates.js';

export function firewall(m, t) {
  const f = m.firewall;
  const firewalld = m.services.find((s) => s.name === 'firewalld');
  // Zones holding no interface and no rule are firewalld's stock ones: noise.
  const zones = f.zones.filter((z) => z.interfaces.length || z.ruleCount);
  return view('firewall', t('view.firewall'), [
    section([
      markdown(`<ha-alert alert-type="warning">${t('help.zoneChange')}</ha-alert>`, {
        text_only: true, grid_options: { columns: 'full' },
      }),
      zoneTable(f, t),
    ], { column_span: 2 }),
    section([
      list(t('section.firewall'), 'mdi:shield-check', [
        row(firewalld?.status, t('name.firewalld')),
        row(f.activeZones, t('name.activeZones')),
        row(f.lastAction, t('name.lastAction')),
        buttonRow(firewalld?.restart, t('action.restartFirewalld'), 'mdi:restart', t('action.restartShort'), t('confirm.firewallRestart')),
      ]),
      portForm(f.portForm, t),
      forwardForm(f.forwardForm, t),
    ]),
    section(zones.map((z) => markdown(zoneDetails(z, t), { title: t('name.zone', { zone: z.name }) }))),
  ], { max_columns: 2 });
}

/** Interfaces and their zone; a click opens the select, one deliberate step away. */
function zoneTable(f, t) {
  const masquerade = new Map(f.zones.map((z) => [z.name, z.masquerade]));
  const rows = f.interfaces.map((i) => ({
    entity: i.zoneSelect,
    cells: {
      name: { text: t.iface(i.name) },
      zone: { entity: i.zoneSelect },
      nat: masquerade.get(i.zone) ? { entity: masquerade.get(i.zone) } : { text: '—' },
    },
  }));
  return table(t('section.interfaces'), 'mdi:ethernet', [
    { key: 'name', label: t('col.interface'), sortable: true },
    { key: 'zone', label: t('col.zone'), sortable: true },
    { key: 'nat', label: t('name.masquerade') },
  ], rows);
}

function zoneDetails(z, t) {
  const ifaces = z.interfaces.length ? z.interfaces.map((i) => `\`${t.iface(i)}\``).join(' ') : '—';
  return `**${t('col.interfaces')}**  \n${ifaces}\n\n${zoneRules(z, t)}`;
}

function portForm(p, t) {
  return list(t('section.portsServices'), 'mdi:door-open', [
    row(p.port, t('name.port')),
    row(p.service, t('name.service')),
    row(p.protocol, t('name.protocol')),
    row(p.zone, t('name.zoneField')),
    buttonRow(p.addPort, t('action.openPort'), 'mdi:door-open', t('action.open'), t('confirm.firewallChange')),
    buttonRow(p.removePort, t('action.closePort'), 'mdi:door-closed', t('action.close'), t('confirm.firewallChange')),
    buttonRow(p.addService, t('action.allowService'), 'mdi:plus-circle', t('action.allow'), t('confirm.firewallChange')),
    buttonRow(p.removeService, t('action.removeService'), 'mdi:minus-circle', t('action.remove'), t('confirm.firewallChange')),
  ]);
}

function forwardForm(f, t) {
  return list(t('section.forwards'), 'mdi:arrow-right-bold', [
    row(f.port, t('name.sourcePort')),
    row(f.toAddress, t('name.toAddress')),
    row(f.toPort, t('name.toPort')),
    row(f.protocol, t('name.protocol')),
    row(f.zone, t('name.zoneField')),
    buttonRow(f.add, t('action.addForward'), 'mdi:plus', t('action.add'), t('confirm.firewallChange')),
    buttonRow(f.remove, t('action.removeForward'), 'mdi:minus', t('action.remove'), t('confirm.firewallChange')),
  ]);
}
