// "Storage": filesystems and disks as tables, hardware counters as a list.

import { list, row, table, section, view } from '../cards.js';

// Usage from which a filesystem is drawn amber, then red (percent).
const WARN = 85;
const FULL = 95;

export function storage(m, t) {
  const s = m.storage;
  return view('storage', t('view.storage'), [
    section([filesystems(s, t), disks(s, t)], { column_span: 2 }),
    section([
      list(t('section.hardware'), 'mdi:alert-octagon-outline', [row(s.hardwareErrors, t('name.hardwareErrors'))]),
    ]),
    section([
      list(t('section.windowsDisk'), 'mdi:microsoft-windows', [
        row(s.windowsDisk.usage, t('name.usage')),
        row(s.windowsDisk.available, t('name.free')),
        row(s.windowsDisk.read, t('name.read')),
        row(s.windowsDisk.write, t('name.write')),
      ]),
    ]),
  ], { max_columns: 2 });
}

function filesystems(s, t) {
  const rows = s.filesystems.map((fs) => ({
    entity: fs.usage,
    cells: {
      mount: { text: fs.mount },
      usage: { entity: fs.usage, numeric: true, dot: true, levels: { warn: WARN, bad: FULL } },
      free: fs.available ? { entity: fs.available, numeric: true } : { text: '—' },
      size: { entity: fs.usage, kind: 'attribute', attribute: 'total_gb', numeric: true, muted: true },
    },
  }));
  return table(t('section.filesystems'), 'mdi:folder-multiple', [
    { key: 'mount', label: t('col.mount'), sortable: true },
    { key: 'usage', label: t('name.usage'), sortable: true, align: 'end' },
    { key: 'free', label: t('name.free'), sortable: true, align: 'end' },
    { key: 'size', label: t('col.sizeGb'), sortable: true, align: 'end' },
  ], rows);
}

function disks(s, t) {
  const rows = s.disks.map((d) => ({
    entity: d.health,
    cells: {
      name: { text: t.disk(d.name) },
      health: { entity: d.health, dot: true },
      read: d.read ? { entity: d.read, numeric: true } : { text: '—' },
      write: d.write ? { entity: d.write, numeric: true } : { text: '—' },
      totalRead: { entity: d.totalRead, numeric: true, muted: true },
      totalWritten: { entity: d.totalWritten, numeric: true, muted: true },
    },
  }));
  return table(t('section.disks'), 'mdi:harddisk', [
    { key: 'name', label: t('col.disk'), sortable: true },
    { key: 'health', label: t('name.smart'), sortable: true },
    { key: 'read', label: t('name.read'), sortable: true, align: 'end' },
    { key: 'write', label: t('name.write'), sortable: true, align: 'end' },
    { key: 'totalRead', label: t('name.totalRead'), sortable: true, align: 'end' },
    { key: 'totalWritten', label: t('name.totalWritten'), sortable: true, align: 'end' },
  ], rows);
}
