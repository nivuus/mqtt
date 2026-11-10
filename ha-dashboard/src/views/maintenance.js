// "Maintenance": updates (host and containers), Home Assistant backups,
// security events.

import {
  heading, tile, updateTile, pressTile, markdown, section, view, when, visibleWhen,
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
    // Both lists follow the update entities live: an image moves from one to
    // the other as soon as its state changes.
    section([
      heading(t('section.containerUpdates'), 'mdi:docker'),
      markdown(t('empty.containerUpdates'), {
        visibility: [{ condition: 'not', conditions: [{
          condition: 'or', conditions: u.containers.map((c) => when.state(c.entity, 'on')),
        }] }],
      }),
      ...u.containers.map((c) => visibleWhen(updateTile(c.entity, { name: c.title }), when.state(c.entity, 'on'))),
    ], { column_span: 2 }),
    section([
      heading(t('section.containersUpToDate'), 'mdi:check-all'),
      ...u.containers.map((c) => visibleWhen(
        tile(c.entity, { name: c.title, hide_state: true, grid_options: { columns: 4 } }),
        when.stateNot(c.entity, 'on'),
      )),
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
