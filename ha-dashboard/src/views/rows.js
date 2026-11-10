// Table rows shared by several views (table-card.js).

import { pressAction } from '../cards.js';

export const SERVICE_COLUMNS = (t) => [
  { key: 'name', label: t('col.name'), sortable: true },
  { key: 'state', label: t('col.state'), sortable: true },
  { key: 'since', label: t('col.since') },
  { key: 'action', label: '', align: 'end' },
];

export function serviceRows(m, t) {
  return m.services.map((s) => ({
    entity: s.status,
    cells: {
      name: { text: t.service(s.name) },
      state: { entity: s.status, dot: true },
      since: { entity: s.status, kind: 'since', muted: true },
    },
    actions: [pressAction(s.restart, t('action.restartShort'), 'mdi:restart',
      t('confirm.serviceRestart', { service: t.service(s.name) }))].filter(Boolean),
  }));
}

export const VM_COLUMNS = SERVICE_COLUMNS;

const VM_RUNNING = ['running', 'paused', 'idle', 'in shutdown'];
const VM_STOPPED = ['shut off', 'crashed', 'pmsuspended'];
const only = (action, entity, states) => action && { ...action, when: { entity, states } };

export function vmRows(m, t) {
  return m.vms.map((v) => ({
    entity: v.state,
    cells: {
      name: { text: v.name },
      state: { entity: v.state, dot: true },
      since: { entity: v.state, kind: 'since', muted: true },
    },
    // libvirt states (virsh domstate): start what is off, stop what runs.
    actions: [
      only(pressAction(v.start, t('action.start'), 'mdi:play'), v.state, VM_STOPPED),
      only(pressAction(v.stop, t('action.stop'), 'mdi:stop', t('confirm.vmStop', { vm: v.name })), v.state, VM_RUNNING),
      only(pressAction(v.restart, t('action.restartShort'), 'mdi:restart', t('confirm.vmRestart', { vm: v.name })), v.state, VM_RUNNING),
    ].filter(Boolean),
  }));
}
