// "Services & VMs": host services with their restart, the VMs, game streaming.

import { heading, tile, pressTile, section, view } from '../cards.js';

export function services(m, t) {
  return view('services', t('view.services'), 'mdi:server', [
    section([
      heading(t('section.hostServices'), 'mdi:cogs'),
      ...m.services.flatMap((s) => [
        tile(s.status, { name: t.service(s.name), state_content: 'state' }),
        pressTile(s.restart, t('action.restart', { service: t.service(s.name) }), 'mdi:restart',
          t('confirm.serviceRestart', { service: t.service(s.name) })),
      ]),
    ], { column_span: 2 }),
    ...m.vms.map((v) => vm(v, t)),
    gaming(m.gaming, t),
  ]);
}

function vm(v, t) {
  return section([
    heading(t('name.vm', { vm: v.name }), 'mdi:monitor'),
    tile(v.state, { name: t('name.state') }),
    pressTile(v.start, t('action.start'), 'mdi:play'),
    pressTile(v.stop, t('action.stop'), 'mdi:stop', t('confirm.vmStop', { vm: v.name })),
    pressTile(v.restart, t('action.restartVm'), 'mdi:restart', t('confirm.vmRestart', { vm: v.name })),
  ]);
}

function gaming(g, t) {
  return section([
    heading(t('section.gaming'), 'mdi:controller'),
    tile(g.streaming, { name: t('name.streaming') }),
    tile(g.streamingService, { name: t('name.streamingService') }),
    tile(g.splitLockActive, { name: t('name.splitLock') }),
    tile(g.splitLockCount, { name: t('name.splitLockCount') }),
    tile(g.splitLockLast, { name: t('name.splitLockLast') }),
  ]);
}
