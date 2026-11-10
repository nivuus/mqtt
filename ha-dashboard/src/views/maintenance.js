// "Maintenance": updates (host and containers), Home Assistant backups,
// security events.

import {
  heading, tile, updateTile, pressTile, markdown, section, view,
} from '../cards.js';
import { packagesList, securityDetails } from './templates.js';

export function maintenance(m, t, backups) {
  const u = m.updates;
  return view('maintenance', t('view.maintenance'), [
    section([
      heading(t('section.hostUpdates'), 'mdi:debian'),
      updateTile(u.apt, { name: t('name.apt') }),
      tile(u.count, { name: t('name.pendingPackages') }),
      u.count && markdown(packagesList(u.count, t)),
      pressTile(u.check, t('action.checkUpdates'), 'mdi:refresh'),
      pressTile(u.apply, t('action.applyUpdates'), 'mdi:download', t('confirm.applyUpdates')),
    ]),
    section([
      heading(t('section.containers'), 'mdi:docker'),
      ...u.containers.map((c) => updateTile(c.entity, { name: c.title })),
    ], { column_span: 2 }),
    backups.length ? section([
      heading(t('section.backups'), 'mdi:backup-restore'),
      ...backups.map((b) => tile(b)),
    ]) : null,
    section([
      heading(t('section.security'), 'mdi:shield-account'),
      tile(m.security.sshLogin, { name: t('name.lastSsh') }),
      tile(m.security.fail2ban, { name: t('name.lastBan') }),
      tile(m.security.virus, { name: t('name.lastVirus') }),
      tile(m.security.syslogError, { name: t('name.lastSyslogError') }),
      tile(m.security.event, { name: t('name.lastEvent') }),
      tile(m.security.alert, { name: t('name.alert') }),
      markdown(securityDetails(m.security, t), { grid_options: { columns: 'full' } }),
    ], { column_span: 2 }),
  ]);
}

/**
 * Home Assistant's own backup entities (the `backup` integration), found in
 * the registry the frontend already holds: they are not the agent's, but a
 * server maintenance page without them would be missing its safety net.
 */
export function backupEntities(hass) {
  return Object.values(hass.entities ?? {})
    .filter((e) => e.platform === 'backup' && !e.hidden)
    .map((e) => e.entity_id)
    .sort();
}
