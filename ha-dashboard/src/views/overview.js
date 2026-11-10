// "Overview": what needs attention first, then the vital signs.

import {
  heading, tile, gauge, trendTile, toggleTile, updateTile, markdown,
  section, view, when, visibleWhen,
} from '../cards.js';
import { attentionChecks, noneFailing } from './attention.js';

export function overview(m, t, nav) {
  const checks = attentionChecks(m, t);
  return view('overview', t('view.overview'), 'mdi:view-dashboard', [
    attention(checks, m, t),
    vitals(m, t, nav),
    network(m, t, nav),
    power(m, t, nav),
    services(m, t, nav),
  ], { badges: badges(m, t) });
}

function attention(checks, m, t) {
  const allFine = markdown(t('attention.allFine'), { visibility: [noneFailing(checks)] });
  return section([
    heading(t('section.attention'), 'mdi:alert-circle-outline'),
    allFine,
    ...checks.map((c) => visibleWhen(c.card, c.show)),
    // Pending updates install from here, without leaving the page.
    ...[m.updates.apt, ...m.updates.containers].map((u) =>
      visibleWhen(updateTile(u), when.state(u, 'on'))),
  ], { column_span: 2 });
}

function vitals(m, t, nav) {
  const root = m.storage.filesystems.find((f) => f.mount === '/');
  return section([
    heading(t('section.system'), 'mdi:server', { tap_action: nav('performance') }),
    gauge(m.cpu.load, t('name.cpu'), { green: 0, yellow: 60, red: 85 }),
    gauge(m.memory.usage, t('name.memory'), { green: 0, yellow: 70, red: 85 }),
    gauge(root?.usage, t('name.rootDisk'), { green: 0, yellow: 75, red: 90 }),
    trendTile(m.cpu.temp, { name: t('name.cpuTemp') }),
    trendTile(m.gpu.temp, { name: t('name.gpuTemp') }),
  ], { column_span: 2 });
}

function network(m, t, nav) {
  const uplink = m.wan[0];
  return section([
    heading(t('section.network'), 'mdi:wan', { tap_action: nav('network') }),
    trendTile(uplink?.traffic.down, { name: t('name.download') }, 1),
    trendTile(uplink?.traffic.up, { name: t('name.upload') }, 1),
    toggleTile(m.guestVpn.switch, { name: t('name.guestVpn') }),
    tile(m.guestVpn.state, { name: t('name.guestVpnState') }),
    ...m.bridges.map((b) => tile(b.count, {
      name: t('name.devicesOn', { bridge: t.bridge(b.name) }),
      icon: 'mdi:devices',
      tap_action: nav('network'),
    })),
  ]);
}

function power(m, t, nav) {
  return section([
    heading(t('section.power'), 'mdi:power-plug-battery', { tap_action: nav('performance') }),
    tile(m.ups.powerSource, { name: t('name.mains') }),
    tile(m.ups.battery, { name: t('name.upsBattery') }),
    trendTile(m.ups.consumption, { name: t('name.consumption') }),
    tile(m.ups.runtime, { name: t('name.upsRuntime') }),
  ]);
}

function services(m, t, nav) {
  return section([
    heading(t('section.services'), 'mdi:cogs', { tap_action: nav('services') }),
    ...m.services.map((s) => tile(s.status, {
      name: t.service(s.name), state_content: 'state', tap_action: nav('services'),
    })),
    ...m.vms.map((v) => tile(v.state, {
      name: t('name.vm', { vm: v.name }), icon: 'mdi:microsoft-windows', tap_action: nav('services'),
    })),
  ], { column_span: 2 });
}

function badges(m, t) {
  const uplink = m.wan[0];
  return [
    m.cpu.load && { type: 'entity', entity: m.cpu.load, name: t('name.cpu'), show_name: true },
    m.cpu.temp && { type: 'entity', entity: m.cpu.temp, name: t('name.cpuTemp'), show_name: true },
    m.memory.usage && { type: 'entity', entity: m.memory.usage, name: t('name.memory'), show_name: true },
    uplink?.traffic.down && { type: 'entity', entity: uplink.traffic.down, name: t('name.download'), show_name: true },
    m.ups.battery && { type: 'entity', entity: m.ups.battery, name: t('name.ups'), show_name: true },
    m.guestVpn.state && { type: 'entity', entity: m.guestVpn.state, name: t('name.guestVpn'), show_name: true },
  ].filter(Boolean);
}
