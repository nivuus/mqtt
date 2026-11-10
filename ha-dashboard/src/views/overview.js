// "Overview": what needs attention first, then the vital signs, as lists and
// tables in the style of Home Assistant's settings pages.

import { list, row, table, markdown, section, view, when } from '../cards.js';
import { attentionChecks, noneFailing } from './attention.js';
import { serviceRows, SERVICE_COLUMNS, vmRows, VM_COLUMNS } from './rows.js';

export function overview(m, t) {
  const checks = attentionChecks(m, t);
  return view('overview', t('view.overview'), [
    section([attention(checks, t), allFine(checks, t)], { column_span: 2 }),
    section([system(m, t), power(m, t)]),
    section([network(m, t), updates(m, t)]),
    section([
      table(t('section.services'), 'mdi:cogs', SERVICE_COLUMNS(t), serviceRows(m, t)),
      table(t('section.vms'), 'mdi:monitor', VM_COLUMNS(t), vmRows(m, t)),
    ], { column_span: 2 }),
  ], { max_columns: 2 });
}

/** One row per failing check; the card itself hides when nothing fails. */
function attention(checks, t) {
  const rows = checks.map((c) => ({
    type: 'conditional',
    conditions: [c.show],
    row: { entity: c.card.entity, name: c.card.name, ...(c.card.icon && { icon: c.card.icon }) },
  }));
  return list(t('section.attention'), 'mdi:alert-circle-outline', rows, {
    visibility: [{ condition: 'or', conditions: checks.map((c) => c.show) }],
  });
}

function allFine(checks, t) {
  return markdown(`<ha-alert alert-type="success">${t('attention.allFine')}</ha-alert>`, {
    visibility: [noneFailing(checks)],
    text_only: true,
    grid_options: { columns: 'full' },
  });
}

function system(m, t) {
  const root = m.storage.filesystems.find((f) => f.mount === '/');
  return list(t('section.system'), 'mdi:server', [
    row(m.cpu.load, t('name.cpu')),
    row(m.cpu.temp, t('name.cpuTemp')),
    row(m.memory.usage, t('name.memory')),
    row(root?.usage, t('name.rootDisk')),
    row(m.gpu.temp, t('name.gpuTemp')),
  ]);
}

function network(m, t) {
  const uplink = m.wan[0];
  return list(t('section.network'), 'mdi:wan', [
    row(uplink?.traffic.down, t('name.download')),
    row(uplink?.traffic.up, t('name.upload')),
    row(m.guestVpn.switch, t('name.guestVpn')),
    row(m.guestVpn.state, t('name.guestVpnState')),
    ...m.bridges.map((b) => row(b.count, t('name.devicesOn', { bridge: t.bridge(b.name) }), { icon: 'mdi:devices' })),
  ]);
}

function power(m, t) {
  return list(t('section.power'), 'mdi:power-plug-battery', [
    row(m.ups.powerSource, t('name.mains')),
    row(m.ups.battery, t('name.upsBattery')),
    row(m.ups.runtime, t('name.upsRuntime')),
    row(m.ups.consumption, t('name.consumption')),
  ]);
}

/** Pending updates only; each row opens Home Assistant's install dialog. */
function updates(m, t) {
  const u = m.updates;
  const pending = [
    u.apt && { entity: u.apt, name: t('name.apt') },
    ...u.containers.map((c) => ({ entity: c.entity, name: c.title })),
  ].filter(Boolean);
  return list(t('section.updates'), 'mdi:update', [
    row(u.count, t('name.pendingPackages')),
    ...pending.map((r) => ({ type: 'conditional', conditions: [when.state(r.entity, 'on')], row: r })),
  ]);
}
