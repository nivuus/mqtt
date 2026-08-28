// src/core/__tests__/discoveryTopic.test.ts

import { sanitizeObjectId } from '../../utils/validators';

// Home Assistant n'accepte, dans chaque segment d'un topic de découverte, que
// [a-zA-Z0-9_-]. Tout le reste fait rejeter le message avec « Received message
// on illegal discovery topic », et l'entité n'apparaît jamais — sans erreur
// côté agent, qui croit avoir publié.
const HA_TOPIC_SEGMENT = /^[a-zA-Z0-9_-]+$/;

// Observé en production le 2026-08-28 : le nom de zone firewalld par défaut
// porte une espace et des parenthèses, et se retrouvait tel quel dans le
// topic. Huit entités du gestionnaire de pare-feu étaient silencieusement
// ignorées par Home Assistant.
const REAL_WORLD = [
  'internal (default)',
  'public (default)',
  'enp6s0.835',
  'br-1a2b3c4d',
  'Disque Système',
  'wlan0:avahi',
];

describe('sanitizeObjectId', () => {
  it.each(REAL_WORLD)('rend « %s » utilisable dans un topic', (raw) => {
    expect(sanitizeObjectId(raw)).toMatch(HA_TOPIC_SEGMENT);
  });

  it('laisse intact ce qui est déjà valide', () => {
    expect(sanitizeObjectId('core_0_temp')).toBe('core_0_temp');
    expect(sanitizeObjectId('total-load')).toBe('total-load');
  });

  it('remplace chaque caractère interdit, sans en perdre la trace', () => {
    // Deux caractères interdits consécutifs (l'espace ET la parenthèse) font
    // deux underscores : c'est ce qui garantit qu'on ne confond pas deux noms
    // voisins, au prix d'un identifiant un peu bavard.
    expect(sanitizeObjectId('internal (default)_services'))
      .toBe('internal__default__services');
  });

  it('ne fusionne pas deux zones distinctes en un même identifiant', () => {
    // Deux zones différentes doivent rester deux entités différentes : un
    // assainissement qui les confondrait ferait disparaître l'une des deux.
    expect(sanitizeObjectId('internal (default)'))
      .not.toBe(sanitizeObjectId('external (default)'));
  });

  it('ne rend jamais une chaîne vide', () => {
    // Un objectId vide produirait « homeassistant/sensor/nivuus//config »,
    // un topic à segment vide qu'HA rejette aussi.
    expect(sanitizeObjectId('()')).toMatch(HA_TOPIC_SEGMENT);
    expect(sanitizeObjectId('')).toMatch(HA_TOPIC_SEGMENT);
  });
});
