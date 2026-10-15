import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeIpv4, parseHosts } from '../src/config.js';

test('normalizeConfig: defaults, French names', () => {
  assert.deepEqual(normalizeConfig(), { hosts: [], invalidHosts: [], language: 'fr' });
  assert.deepEqual(normalizeConfig(null), normalizeConfig(DEFAULT_CONFIG));
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
});

test('parseHosts: separators, duplicates, leading zeros, invalid entries', () => {
  assert.deepEqual(parseHosts(' 192.0.2.10, 192.0.2.011;192.0.2.10\n192.0.2.12 '), {
    hosts: ['192.0.2.10', '192.0.2.11', '192.0.2.12'],
    invalid: [],
  });
  assert.deepEqual(parseHosts('fan.local, 300.1.1.1, fe80::1, 192.0.2.5'), {
    hosts: ['192.0.2.5'],
    invalid: ['fan.local', '300.1.1.1', 'fe80::1'],
  });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('normalizeIpv4', () => {
  assert.equal(normalizeIpv4('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIpv4(' 010.0.0.1 '), '10.0.0.1');
  assert.equal(normalizeIpv4('256.0.0.1'), null);
  assert.equal(normalizeIpv4(42), null);
});
