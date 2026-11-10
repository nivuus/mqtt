// "Maintenance": container and host updates, Home Assistant backups,
// security events.

import { list, row, buttonRow, table, markdown, section, view } from '../cards.js';
import { packagesList, securityDetails } from './templates.js';

export function maintenance(m, t, backups) {
  const u = m.updates;
  return view('maintenance', t('view.maintenance'), [
    section([containers(u, t)], { column_span: 2 }),
    section([
      list(t('section.hostUpdates'), 'mdi:debian', [
        row(u.apt, t('name.apt')),
        row(u.count, t('name.pendingPackages')),
        buttonRow(u.check, t('action.checkUpdates'), 'mdi:refresh', t('action.run')),
        buttonRow(u.apply, t('action.applyUpdates'), 'mdi:download', t('action.install'), t('confirm.applyUpdates')),
      ]),
      u.count && markdown(packagesList(u.count, t), { title: t('name.pendingPackages') }),
      backups.length ? list(t('section.backups'), 'mdi:backup-restore', backups.map((b) => row(b))) : null,
    ]),
    section([
      list(t('section.security'), 'mdi:shield-account', [
        row(m.security.sshLogin, t('name.lastSsh')),
        row(m.security.fail2ban, t('name.lastBan')),
        row(m.security.virus, t('name.lastVirus')),
        row(m.security.syslogError, t('name.lastSyslogError')),
        row(m.security.event, t('name.lastEvent')),
        row(m.security.alert, t('name.alert')),
      ]),
      markdown(securityDetails(m.security, t), { title: t('section.securityDetails') }),
    ]),
  ], { max_columns: 2 });
}

/**
 * Every container image: installed and latest version, and an Install action
 * on the rows that have an update, confirmed through Home Assistant.
 */
function containers(u, t) {
  const rows = u.containers.map((c) => ({
    entity: c.entity,
    cells: {
      name: { text: c.title },
      status: { entity: c.entity, dot: true, tones: { on: 'warn', off: 'ok' } },
      installed: { entity: c.entity, kind: 'attribute', attribute: 'installed_version', muted: true },
      latest: { entity: c.entity, kind: 'attribute', attribute: 'latest_version', muted: true },
    },
    actions: [{
      label: t('action.install'), icon: 'mdi:download',
      when: { entity: c.entity, states: ['on'] },
      tap_action: {
        action: 'perform-action', perform_action: 'update.install', target: { entity_id: c.entity },
        confirmation: { text: t('confirm.containerUpdate', { name: c.title }) },
      },
    }],
  }));
  return table(t('section.containers'), 'mdi:docker', [
    { key: 'name', label: t('col.image'), sortable: true },
    { key: 'status', label: t('col.state'), sortable: true },
    { key: 'installed', label: t('col.installed') },
    { key: 'latest', label: t('col.latest') },
    { key: 'action', label: '', align: 'end' },
  ], rows);
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
