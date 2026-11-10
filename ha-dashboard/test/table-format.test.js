import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tone, level, relative } from '../src/table-format.js';

test('state dots: running is green, stopped is red, the rest neutral', () => {
  assert.equal(tone('active'), 'ok');
  assert.equal(tone('shut off'), 'bad');
  assert.equal(tone('Active (2.4+5GHz)'), '');
});

test('numeric dots follow thresholds and ignore non-numbers', () => {
  assert.equal(level('41.7', { warn: 85, bad: 95 }), 'ok');
  assert.equal(level('89.4', { warn: 85, bad: 95 }), 'warn');
  assert.equal(level('95', { warn: 85, bad: 95 }), 'bad');
  assert.equal(level('unknown', { warn: 85, bad: 95 }), '');
});

test('relative times are written in the requested language', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  // French separates the number with a narrow no-break space (U+202F).
  assert.match(relative(twoHoursAgo, 'fr'), /2\s+h/u);
  assert.match(relative(twoHoursAgo, 'en'), /2\s+hr/u);
  assert.equal(relative('not a date', 'fr'), '');
});
