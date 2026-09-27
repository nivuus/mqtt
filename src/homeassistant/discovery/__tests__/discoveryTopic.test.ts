// src/homeassistant/discovery/__tests__/discoveryTopic.test.ts

import { discoveryTopic, toTopicSegment } from '../discoveryTopic';

// Home Assistant matches every discovery topic against
//   (?P<component>\w+)/(?:(?P<node_id>[a-zA-Z0-9_-]+)/)?(?P<object_id>[a-zA-Z0-9_-]+)/config
// (homeassistant/components/mqtt/discovery.py, TOPIC_MATCHER). Anything else is
// dropped with "Received message on illegal discovery topic" — silently, from
// the agent's point of view: the broker accepts the publish, HA discards it.
const HA_TOPIC_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const HA_TOPIC_MATCHER =
  /^homeassistant\/\w+\/(?:[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\/config$/;

// Values seen in production (2026-08-28) plus names in other scripts: a device,
// zone or disk name may be written in any language the host's owner uses.
const RAW_VALUES = [
  'internal (default)',
  'public (default)',
  'enp6s0.835',
  'wlan0:avahi',
  'Disque Système',
  'Salón principal',
  'Wohnzimmer Größe',
  'Гостиная',
  '客厅',
  'غرفة المعيشة',
  'リビング',
  '🔥',
  '()',
  '',
];

describe('toTopicSegment', () => {
  it.each(RAW_VALUES)('makes %j a legal discovery topic segment', (raw) => {
    expect(toTopicSegment(raw)).toMatch(HA_TOPIC_SEGMENT);
  });

  it('leaves an already legal segment untouched, so existing entities keep their id', () => {
    expect(toTopicSegment('core_0_temp')).toBe('core_0_temp');
    expect(toTopicSegment('total-load')).toBe('total-load');
    expect(toTopicSegment('nivuus_firewall_public_services')).toBe('nivuus_firewall_public_services');
  });

  it('keeps Latin letters readable by dropping their diacritics', () => {
    expect(toTopicSegment('Disque Système')).toMatch(/^Disque_Systeme_/);
  });

  it('is deterministic, so republishing targets the same entity', () => {
    expect(toTopicSegment('internal (default)')).toBe(toTopicSegment('internal (default)'));
    expect(toTopicSegment('客厅')).toBe(toTopicSegment('客厅'));
  });

  // Distinct inputs must stay distinct entities: a collision makes one entity
  // overwrite the other in Home Assistant, which is data loss with no error.
  it.each([
    ['enp6s0.835', 'enp6s0_835'],
    ['enp6s0.835', 'enp6s0:835'],
    ['internal (default)', 'internal _default_'],
    ['internal (default)', 'external (default)'],
    ['Disque Système', 'Disque Systeme'],
    ['Disque Système', 'Disque Systéme'],
    ['客厅', '卧室'],
    ['Гостиная', 'Спальня1'],
    ['غرفة', 'مطبخ'],
    ['()', '[]'],
    ['()', ''],
  ])('keeps %j and %j distinct', (a, b) => {
    expect(toTopicSegment(a)).not.toBe(toTopicSegment(b));
  });

  it('never collides across the whole sample set', () => {
    const segments = RAW_VALUES.map(toTopicSegment);
    expect(new Set(segments).size).toBe(RAW_VALUES.length);
  });
});

describe('discoveryTopic', () => {
  it('builds a topic Home Assistant accepts', () => {
    expect(discoveryTopic('sensor', 'nivuus', 'nivuus_firewall_internal (default)_services'))
      .toMatch(HA_TOPIC_MATCHER);
  });

  it('sanitises the node_id segment as well as the object_id', () => {
    expect(discoveryTopic('sensor', 'mon serveur', 'cpu_load')).toMatch(HA_TOPIC_MATCHER);
  });

  it('leaves a legal topic unchanged', () => {
    expect(discoveryTopic('update', 'nivuus', 'nivuus_docker_updates_ollama'))
      .toBe('homeassistant/update/nivuus/nivuus_docker_updates_ollama/config');
  });
});
