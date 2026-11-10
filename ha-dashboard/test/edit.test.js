import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleOf, ruleText } from '../src/edit/zone-card.js';

test('zone list items become the rule the agent expects', () => {
  assert.deepEqual(ruleOf('service', 'ssh'), { kind: 'service', service: 'ssh' });
  assert.deepEqual(ruleOf('port', '3478/udp'), { kind: 'port', port: '3478', protocol: 'udp' });
  assert.deepEqual(ruleOf('forward', { port: '47984', proto: 'tcp', toport: '47984', toaddr: '192.168.3.2' }),
    { kind: 'forward', port: '47984', protocol: 'tcp', toaddr: '192.168.3.2', toport: '47984' });
});

test('rules read as firewalld writes them', () => {
  assert.equal(ruleText({ kind: 'service', service: 'ssh' }), 'ssh');
  assert.equal(ruleText({ kind: 'port', port: '6000-6010', protocol: 'tcp' }), '6000-6010/tcp');
  assert.equal(ruleText({ kind: 'forward', port: '80', protocol: 'tcp', toaddr: '192.168.3.2', toport: '8080' }), '80/tcp → 192.168.3.2:8080');
});
