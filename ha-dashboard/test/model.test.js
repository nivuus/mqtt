import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/model/index.js';
import { selectAgentEntries, indexByUniqueId } from '../src/registry.js';

// Registry rows and last states of the reference host, anonymised.
const host = JSON.parse(readFileSync(new URL('./fixtures/host.json', import.meta.url)));
const entries = selectAgentEntries(host.entries);
const model = buildModel(entries, host.states);

test('only enabled MQTT entities with a nivuus_ unique_id are kept', () => {
  assert.ok(!entries.some((e) => e.unique_id === 'other_thing'));
  const disabled = { entity_id: 'sensor.x', unique_id: 'nivuus_x', platform: 'mqtt', disabled_by: 'user' };
  assert.deepEqual(selectAgentEntries([disabled]), []);
});

test('the discovery digest is stripped from unique ids', () => {
  const index = indexByUniqueId([
    { unique_id: 'nivuus_network_stats_enp5s0_832_download_speed_dc56f6d2', entity_id: 'sensor.a' },
  ]);
  assert.equal(index.get('nivuus_network_stats_enp5s0_832_download_speed'), 'sensor.a');
});

test('CPU cores are found whatever the entity_id prefix, in numeric order', () => {
  assert.equal(model.cpu.cores.length, 24);
  assert.deepEqual(model.cpu.cores.slice(0, 3).map((c) => c.n), [1, 2, 3]);
  assert.ok(model.cpu.cores[0].load.startsWith('sensor.linux_system_agent_'));
  assert.ok(model.cpu.load);
});

test('filesystems are labelled by mount point, not by entity name', () => {
  const mounts = model.storage.filesystems.map((f) => f.mount);
  assert.ok(mounts.includes('/'));
  assert.ok(mounts.includes('/media/data'));
  const data = model.storage.filesystems.find((f) => f.mount === '/media/data');
  // The entity is called "media backup" on the reference host.
  assert.match(data.usage, /media_backup/);
});

test('disks that never produced SMART data are left out', () => {
  const names = model.storage.disks.map((d) => d.name);
  assert.ok(names.includes('nvme0n1'));
  assert.ok(names.includes('sda'));
  assert.ok(!names.some((n) => n.startsWith('nbd')));
  assert.ok(!names.includes('sdc'));
});

test('WAN is the external-zone uplink, PPPoE fallback set apart', () => {
  assert.deepEqual(model.wan.map((i) => i.name), ['enp5s0_832']);
  assert.ok(model.wan[0].traffic.down);
  assert.ok(model.pppoe.save);
});

test('bridges carry their zone select and traffic, with the live casing', () => {
  const local = model.bridges.find((b) => b.name === 'localBridge');
  assert.ok(local.zoneSelect);
  assert.equal(local.zone, 'home');
  assert.equal(local.traffic.down, 'sensor.nivuus_network_localbridge_download_speed');
});

test('form selects are not mistaken for interfaces', () => {
  assert.ok(!model.interfaces.some((i) => i.name === 'forward'));
});

test('firewall zones list the interfaces they hold', () => {
  const home = model.firewall.zones.find((z) => z.name === 'home');
  assert.ok(home.interfaces.includes('localBridge'));
  assert.ok(home.services && home.ports && home.forwards);
});

test('Wi-Fi networks are paired with their bridge', () => {
  const byLabel = Object.fromEntries(model.wifi.networks.map((n) => [n.label, n]));
  assert.equal(byLabel.home.bridge, 'localBridge');
  assert.equal(byLabel.guest.bridge, 'publicBridge');
  assert.ok(byLabel.guest.apply && byLabel.guest.delete);
});

test('every VM the agent declared is listed, including names with dashes', () => {
  assert.deepEqual(model.vms.map((v) => v.name), ['Windows', 'Windows-LTSC-test']);
  assert.ok(model.vms.every((v) => v.start && v.stop && v.restart));
});

test('services, updates and security events resolve', () => {
  assert.ok(model.services.some((s) => s.name === 'docker' && s.restart));
  assert.ok(model.updates.apt);
  assert.ok(model.updates.containers.length > 10);
  assert.ok(model.security.sshLogin && model.security.virus);
});
