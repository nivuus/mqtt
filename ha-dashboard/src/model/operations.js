// Operations side of the model: services, VMs, updates, security events.

import { naturalCompare } from './lookup.js';

export function services(q) {
  return q.all('service_(.+)_status')
    .map(({ match, entityId }) => ({
      name: match[1],
      status: entityId,
      restart: q.id(`service_${match[1]}_restart`),
    }))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function vms(q) {
  return q.all('vm_manager_(.+)_state')
    .map(({ match, entityId }) => {
      const name = match[1];
      return {
        name,
        state: entityId,
        start: q.id(`vm_manager_${name}_start`),
        stop: q.id(`vm_manager_${name}_stop`),
        restart: q.id(`vm_manager_${name}_restart`),
      };
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function gaming(q) {
  const SL = 'kvm_split_lock_monitor';
  return {
    streaming: q.id('streaming_status'),
    streamingService: q.id('streaming_service'),
    splitLockActive: q.id(`${SL}_split_lock_active`),
    splitLockCount: q.id(`${SL}_split_lock_count`),
    splitLockLast: q.id(`${SL}_split_lock_last_event`),
  };
}

export function updates(q) {
  return {
    apt: q.id('apt_updates_apt'),
    containers: q.all('docker_updates_(.+)')
      .map(({ entityId }) => entityId)
      .sort(naturalCompare),
    pending: q.id('system_updates_available'),
    count: q.id('system_updates_count'),
    check: q.id('system_updates_check_updates'),
    apply: q.id('system_updates_apply_updates'),
  };
}

export function security(q) {
  const event = (kind) => q.id(`event_monitor_last_${kind}_event`);
  return {
    sshLogin: event('ssh_login'),
    fail2ban: event('fail2ban_ban'),
    virus: event('clamav_virus'),
    syslogError: event('syslog_error'),
    alert: q.id('alert'),
    event: q.id('event'),
  };
}
