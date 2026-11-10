// "Firewall": where each interface sits, then one editor per zone (its
// interfaces, services, ports and forwards, each removable, and an add form).

import { list, row, buttonRow, table, markdown, section, view, zoneCard } from '../cards.js';

export function firewall(m, t) {
  const f = m.firewall;
  const firewalld = m.services.find((s) => s.name === 'firewalld');
  // Zones holding no interface and no rule are firewalld's stock ones: noise.
  const zones = f.zones.filter((z) => z.interfaces.length || z.ruleCount);
  return view('firewall', t('view.firewall'), [
    section([
      markdown(`<ha-alert alert-type="info">${t('help.zoneChange')}</ha-alert>`, {
        text_only: true, grid_options: { columns: 'full' },
      }),
      zoneTable(f, t),
    ], { column_span: 2 }),
    section([
      list(t('section.firewall'), 'mdi:shield-check', [
        row(firewalld?.status, t('name.firewalld')),
        row(f.activeZones, t('name.activeZones')),
        buttonRow(firewalld?.restart, t('action.restartFirewalld'), 'mdi:restart', t('action.restartShort'), t('confirm.firewallRestart')),
      ]),
    ], { column_span: 2 }),
    ...zones.map((z) => section([zoneCard(z, f.lastAction)])),
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
