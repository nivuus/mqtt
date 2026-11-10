// Checks shown at the top of the overview, only while they fail.
//
// Each check is a card plus the condition under which it fails. The "all
// fine" note is visible only when no check fails. Home Assistant evaluates the
// conditions live in the browser, so the section follows the server without
// regenerating the dashboard.

import { tile, gaugeTile, when } from '../cards.js';

// Usage above this share of a filesystem deserves a look.
export const FILESYSTEM_WARN_PERCENT = 85;
// CPU package temperature above which the cooling deserves a look.
export const CPU_TEMP_WARN_C = 85;

export function attentionChecks(m, t) {
  const checks = [];
  const add = (card, show) => card && checks.push({ card, show });

  // The agent went away: every other card would only show "unavailable".
  add(
    tile(m.cpu.load, { name: t('attention.agentOffline'), icon: 'mdi:lan-disconnect' }),
    when.state(m.cpu.load, 'unavailable'),
  );
  for (const fs of m.storage.filesystems) {
    add(
      gaugeTile(fs.usage, { name: t('attention.filesystemFull', { mount: fs.mount }) }),
      when.above(fs.usage, FILESYSTEM_WARN_PERCENT),
    );
  }
  for (const disk of m.storage.disks) {
    add(
      tile(disk.health, { name: t('attention.diskHealth', { disk: t.disk(disk.name) }) }),
      when.stateNot(disk.health, 'PASSED'),
    );
  }
  for (const s of m.services) {
    add(
      tile(s.status, { name: t('attention.serviceDown', { service: t.service(s.name) }) }),
      when.stateNot(s.status, 'active'),
    );
  }
  add(tile(m.ups.powerSource, { name: t('attention.onBattery') }), when.state(m.ups.powerSource, 'off'));
  add(tile(m.cpu.temp, { name: t('attention.cpuHot') }), when.above(m.cpu.temp, CPU_TEMP_WARN_C));
  add(tile(m.cpu.machineChecks, { name: t('attention.machineChecks') }), when.above(m.cpu.machineChecks, 0));
  add(tile(m.cpu.thermalEvents, { name: t('attention.thermalEvents') }), when.above(m.cpu.thermalEvents, 0));
  // The guest VPN is wanted but not up: guests are on the plain uplink.
  if (m.guestVpn.switch) {
    add(
      tile(m.guestVpn.state, { name: t('attention.vpnDown') }),
      when.and([when.state(m.guestVpn.switch, 'on'), when.stateNot(m.guestVpn.state, 'connected')]),
    );
  }
  if (m.updates.pending) {
    add(
      tile(m.updates.count, { name: t('attention.systemUpdates'), icon: 'mdi:package-up' }),
      when.state(m.updates.pending, 'on'),
    );
  }
  return checks;
}

/**
 * Condition that holds when none of the checks fails. Home Assistant's `not`
 * negates the conjunction of its conditions ("not all"), hence the `or`.
 */
export const noneFailing = (checks) => ({
  condition: 'not',
  conditions: [{ condition: 'or', conditions: checks.map((c) => c.show) }],
});
