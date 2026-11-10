import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/model/index.js';
import { selectAgentEntries } from '../src/registry.js';
import { makeTranslator } from '../src/i18n/index.js';
import { VIEWS, buildView } from '../src/views/index.js';

const host = JSON.parse(readFileSync(new URL('./fixtures/host.json', import.meta.url)));
const entries = selectAgentEntries(host.entries);
const known = new Set(host.entries.map((e) => e.entity_id));
const hass = { entities: { 'sensor.backup_state': { entity_id: 'sensor.backup_state', platform: 'backup' } } };
known.add('sensor.backup_state');

function ctx(language = 'fr', list = entries) {
  return {
    m: buildModel(list, host.states),
    t: makeTranslator(language),
    nav: (path) => ({ action: 'navigate', navigation_path: `/server/${path}` }),
    hass,
    agentFound: list.length > 0,
  };
}

function* walk(node, path = '$') {
  yield [node, path];
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* walk(v, `${path}.${k}`);
  }
}

const KEY_PREFIXES = /^(view|section|name|action|confirm|help|col|empty|attention|bridge|disk|service|dashboard)\.[\w.]+$/;

for (const { key } of VIEWS) {
  test(`view ${key}: well-formed sections view`, () => {
    const v = buildView(key, ctx());
    assert.equal(v.type, 'sections');
    assert.equal(v.path, key);
    assert.ok(v.sections.length > 0);
    for (const s of v.sections) {
      assert.equal(s.type, 'grid');
      assert.ok(s.cards.length > 0);
    }
  });

  test(`view ${key}: only real entities, no undefined, no raw key`, () => {
    const v = buildView(key, ctx());
    for (const [node, path] of walk(v)) {
      assert.notEqual(node, undefined, `undefined at ${path}`);
      assert.ok(!(typeof node === 'number' && Number.isNaN(node)), `NaN at ${path}`);
      if (typeof node === 'string') {
        assert.doesNotMatch(node, KEY_PREFIXES, `untranslated key at ${path}`);
        assert.doesNotMatch(node, /\{\w+\}/, `unfilled placeholder at ${path}`);
      }
      if (node && typeof node === 'object' && typeof node.entity === 'string') {
        assert.ok(known.has(node.entity), `unknown entity ${node.entity} at ${path}`);
      }
    }
  });
}

test('every press that interrupts something asks first', () => {
  const risky = /restart|stop|delete|apply|add_hotspot|reload|forward|port|service_btn|save|battery_test/;
  for (const { key } of VIEWS) {
    for (const [node] of walk(buildView(key, ctx()))) {
      if (node?.tap_action?.perform_action !== 'button.press') continue;
      const entity = node.tap_action.target.entity_id;
      if (/check_now|test_pppoe/.test(entity)) continue;
      if (risky.test(entity)) assert.ok(node.tap_action.confirmation?.text, `no confirmation on ${entity}`);
    }
  }
});

test('every edit form confirms a press that interrupts something', () => {
  for (const { key } of VIEWS) {
    for (const [node] of walk(buildView(key, ctx()))) {
      if (node?.type !== 'custom:nivuus-form-card') continue;
      if (node.remove) assert.ok(node.remove.confirm, `no confirmation on ${node.remove.entity}`);
      if (/apply|add_hotspot|save/.test(node.submit.entity)) assert.ok(node.submit.confirm, `no confirmation on ${node.submit.entity}`);
      for (const f of node.fields) assert.match(f.entity, /^(text|select)\./, `${f.entity} is not an input`);
    }
  }
});

test('each zone with rules or interfaces gets an editor wired to the command sensor', () => {
  const cards = [...walk(buildView('firewall', ctx()))].map(([n]) => n).filter((n) => n?.type === 'custom:nivuus-zone-card');
  assert.deepEqual(cards.map((c) => c.zone).sort(), ['docker', 'drop', 'external', 'home', 'internal', 'public', 'trusted']);
  for (const c of cards) assert.match(c.lastAction, /^sensor\..*last_action$/);
  assert.ok(cards.find((c) => c.zone === 'home').interfaces.includes('localBridge'));
});

test('the overview shows the all-clear note only when no check fails', () => {
  const [attention] = buildView('overview', ctx()).sections;
  const note = attention.cards.find((c) => c.type === 'markdown');
  const [not] = note.visibility;
  assert.equal(not.condition, 'not');
  assert.equal(not.conditions[0].condition, 'or');
  assert.ok(not.conditions[0].conditions.length >= 5);
});

test('without any agent entity, each view explains why it is empty', () => {
  const v = buildView('network', ctx('en', []));
  assert.match(v.sections[0].cards[0].content, /mqtt-system-agent/);
});

test('English labels too', () => {
  const v = buildView('overview', ctx('en'));
  assert.equal(v.title, 'Overview');
});
