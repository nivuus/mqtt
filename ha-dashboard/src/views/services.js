// "Services & VMs": host services and VMs as tables, game streaming as a list.

import { list, row, table, section, view } from '../cards.js';
import { serviceRows, SERVICE_COLUMNS, vmRows, VM_COLUMNS } from './rows.js';

export function services(m, t) {
  const g = m.gaming;
  return view('services', t('view.services'), [
    section([
      table(t('section.hostServices'), 'mdi:cogs', SERVICE_COLUMNS(t), serviceRows(m, t)),
      table(t('section.vms'), 'mdi:monitor', VM_COLUMNS(t), vmRows(m, t)),
    ], { column_span: 2 }),
    section([
      list(t('section.gaming'), 'mdi:controller', [
        row(g.streaming, t('name.streaming')),
        row(g.streamingService, t('name.streamingService')),
        row(g.splitLockActive, t('name.splitLock')),
        row(g.splitLockCount, t('name.splitLockCount')),
        row(g.splitLockLast, t('name.splitLockLast')),
      ]),
    ], { column_span: 2 }),
  ], { max_columns: 2 });
}
