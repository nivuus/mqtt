import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTranslator, dictionaryFor } from '../src/i18n/index.js';
import enLabels from '../src/i18n/en-labels.js';
import enMessages from '../src/i18n/en-messages.js';
import frLabels from '../src/i18n/fr-labels.js';
import frMessages from '../src/i18n/fr-messages.js';

test('French has every English key and nothing else', () => {
  const en = Object.keys({ ...enLabels, ...enMessages }).sort();
  const fr = Object.keys({ ...frLabels, ...frMessages }).sort();
  assert.deepEqual(fr, en);
});

test('regional tags use their base language; unknown languages fall back to English', () => {
  assert.equal(dictionaryFor('fr-CA'), dictionaryFor('fr'));
  assert.equal(makeTranslator('ja')('view.overview'), 'Overview');
  assert.equal(makeTranslator('fr')('view.overview'), 'Aperçu');
});

test('placeholders are filled, unknown names keep their raw form', () => {
  const t = makeTranslator('fr');
  assert.equal(t('section.editNetwork', { ssid: 'Maison' }), 'Modifier Maison');
  assert.equal(t.bridge('localBridge'), 'Réseau de la maison');
  assert.equal(t.bridge('labBridge'), 'labBridge');
  assert.equal(t.disk('sdz'), 'Disque sdz');
});
