// -----------------------------------------------------------------------------
// What each device gets (capabilities), the values published and the
// properties each command writes, and the reading of the mDNS records.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brightnessLevel,
  brightnessPercent,
  capabilitiesOf,
  isIdentified,
  mergeCapabilities,
  restoreCapabilities,
} from '../src/baf/model.js';
import { MODE } from '../src/baf/proto.js';
import { FEATURE_KEYS as K, applyWrite, commandFor, deviceValues } from '../src/devices.js';
import { normalizeUuid, parseMdnsResults } from '../src/discovery.js';
import { FakeFan, loadFixture } from './helpers/fakeFan.js';
import { ES6, HAIKU, I6, LIGHT, UPLIGHT } from './helpers/world.js';

const record = (fixture, changes = {}) => {
  const properties = { ...loadFixture(fixture), ...changes };
  return { properties, caps: capabilitiesOf(properties) };
};

test('capabilities follow the flags and properties, never the model name', () => {
  assert.deepEqual(capabilitiesOf(loadFixture(HAIKU)), {
    fan: true,
    reverse: true,
    whoosh: true,
    light: true,
    colorTemperature: null,
    temperature: true,
    humidity: true,
    occupancy: true,
  });
  // Uplight only: the light_* properties drive the uplight (aiobafi6).
  // API 4: no occupancy; humidity 0: no humidity sensor.
  assert.deepEqual(capabilitiesOf(loadFixture(UPLIGHT)), {
    fan: true,
    reverse: true,
    whoosh: true,
    light: true,
    colorTemperature: null,
    temperature: true,
    humidity: false,
    occupancy: false,
  });
  // No Auto Comfort: no temperature; humidity 255 is out of range.
  const es6 = capabilitiesOf(loadFixture(ES6));
  assert.equal(es6.temperature, false);
  assert.equal(es6.humidity, false);
  assert.equal(es6.light, false);
  assert.equal(es6.reverse, false);
  // A light without fan, with its white range.
  const light = capabilitiesOf(loadFixture(LIGHT));
  assert.equal(light.fan, false);
  assert.deepEqual(light.colorTemperature, { min: 2200, max: 5000 });
  assert.equal(capabilitiesOf(loadFixture(I6)).light, false);
});

test('capabilities only grow, and survive a round trip through /data', () => {
  const first = capabilitiesOf(loadFixture(HAIKU));
  const later = capabilitiesOf({ fan_mode: 1, capabilities: {} });
  assert.deepEqual(mergeCapabilities(first, later), first);
  assert.deepEqual(restoreCapabilities(JSON.parse(JSON.stringify(first))), first);
  assert.equal(restoreCapabilities(null), null);
  assert.equal(
    restoreCapabilities({ colorTemperature: { min: 5, max: 2 } }).colorTemperature,
    null,
  );
});

test('a fan is identified once it sent the properties aiobafi6 requires', () => {
  const props = loadFixture(ES6);
  assert.equal(isIdentified(props), true);
  delete props.capabilities;
  assert.equal(isIdentified(props), false);
});

test('values: on, auto and off are the three positions of the fan mode', () => {
  const on = deviceValues(record(HAIKU));
  assert.equal(on[K.FAN], 1);
  assert.equal(on[K.FAN_AUTO], 0);
  assert.equal(on[K.SPEED], 3);
  assert.equal(on[K.DIRECTION], 0);
  assert.equal(on[K.WHOOSH], 0);
  assert.equal(on[K.LIGHT], 0);
  assert.equal(on[K.BRIGHTNESS], 50);
  assert.equal(on[K.TEMPERATURE], 22.2);
  assert.equal(on[K.HUMIDITY], 48);
  assert.equal(on[K.OCCUPANCY], 1);

  const auto = deviceValues(record(UPLIGHT));
  assert.equal(auto[K.FAN], 0);
  assert.equal(auto[K.FAN_AUTO], 1);
  assert.equal(auto[K.SPEED], 1);
  assert.equal(auto[K.DIRECTION], 1);
  assert.equal(auto[K.TEMPERATURE], -1.5);
  assert.equal(auto[K.HUMIDITY], undefined);

  // Off: speed 0, whatever speed the fan remembers.
  const off = deviceValues(record(I6));
  assert.equal(off[K.FAN], 0);
  assert.equal(off[K.SPEED], 0);
  assert.equal(off[K.WHOOSH], 1);

  const light = deviceValues(record(LIGHT));
  assert.equal(light[K.LIGHT], 0);
  assert.equal(light[K.LIGHT_AUTO], 1);
  assert.equal(light[K.COLOR_TEMPERATURE], 3500);
  assert.equal(light[K.FAN], undefined);
});

test('brightness: percent, else level; a level is never 0', () => {
  assert.equal(brightnessPercent({ light_brightness_percent: 81 }), 81);
  assert.equal(brightnessPercent({ light_brightness_level: 8 }), 50);
  assert.equal(brightnessPercent({}), undefined);
  assert.equal(brightnessLevel(1), 1);
  assert.equal(brightnessLevel(50), 8);
  assert.equal(brightnessLevel(100), 16);
  assert.equal(applyWrite({}, { light_brightness_level: 8 }).light_brightness_percent, 50);
});

test('commands write what Home Assistant writes', () => {
  const haiku = record(HAIKU);
  assert.deepEqual(commandFor(haiku, K.FAN, 0), [{ fan_mode: MODE.OFF }]);
  assert.deepEqual(commandFor(haiku, K.FAN, 1), [{ fan_mode: MODE.ON }]);
  assert.deepEqual(commandFor(haiku, K.FAN_AUTO, 1), [{ fan_mode: MODE.AUTO }]);
  // Not in auto: nothing to leave.
  assert.deepEqual(commandFor(haiku, K.FAN_AUTO, 0), []);
  assert.deepEqual(commandFor(record(UPLIGHT), K.FAN_AUTO, 0), [{ fan_mode: MODE.OFF }]);
  // Already on: only the speed; off or auto: on first.
  assert.deepEqual(commandFor(haiku, K.SPEED, 5), [{ speed: 5 }]);
  assert.deepEqual(commandFor(record(I6), K.SPEED, 9), [{ fan_mode: MODE.ON }, { speed: 7 }]);
  assert.deepEqual(commandFor(record(UPLIGHT), K.SPEED, 2), [{ fan_mode: MODE.ON }, { speed: 2 }]);
  assert.deepEqual(commandFor(haiku, K.SPEED, 0), [{ fan_mode: MODE.OFF }]);
  assert.deepEqual(commandFor(haiku, K.DIRECTION, 1), [{ reverse_enable: true }]);
  assert.deepEqual(commandFor(haiku, K.WHOOSH, 1), [{ whoosh_enable: true }]);
  assert.deepEqual(commandFor(haiku, K.LIGHT, 1), [{ light_mode: MODE.ON }]);
  assert.deepEqual(commandFor(haiku, K.LIGHT_AUTO, 1), [{ light_mode: MODE.AUTO }]);
  assert.deepEqual(commandFor(haiku, K.BRIGHTNESS, 30), [
    { light_mode: MODE.ON },
    { light_brightness_level: 5 },
  ]);
  assert.deepEqual(commandFor(haiku, K.BRIGHTNESS, 0), [{ light_mode: MODE.OFF }]);
  assert.deepEqual(commandFor(record(LIGHT), K.COLOR_TEMPERATURE, 9000), [
    { light_color_temperature: 5000 },
    { light_mode: MODE.ON },
  ]);
  assert.deepEqual(commandFor(record(LIGHT), K.LIGHT_AUTO, 0), [{ light_mode: MODE.OFF }]);
});

test('commands refuse what the device does not have, and non-numbers', () => {
  assert.throws(() => commandFor(record(ES6), K.LIGHT, 1), { code: 'unsupported' });
  assert.throws(() => commandFor(record(ES6), K.DIRECTION, 1), { code: 'unsupported' });
  assert.throws(() => commandFor(record(LIGHT), K.SPEED, 1), { code: 'unsupported' });
  assert.throws(() => commandFor(record(HAIKU), K.TEMPERATURE, 20), { code: 'unsupported' });
  assert.throws(() => commandFor(record(HAIKU), K.SPEED, 'fast'), { code: 'invalid' });
});

test('mDNS: the fans of the browse, one per UUID, IPv4 only', () => {
  const haiku = new FakeFan(HAIKU, '192.0.2.10').mdnsRecord();
  const found = parseMdnsResults([
    haiku,
    { ...haiku, addresses: ['192.0.2.99'] },
    // Another product announcing the generic _api._tcp service.
    { name: 'Printer._api._tcp.local', addresses: ['192.0.2.50'], txt: ['path=/api'] },
    // SenseME era firmware.
    { ...haiku, txt: ['api version=3', 'model=Haiku', 'uuid=old-fan-0001', 'name=Old'] },
    { ...haiku, txt: ['api version=5', 'model=i6', 'uuid=ipv6-fan-0001'], addresses: ['fe80::1'] },
    null,
  ]);
  assert.deepEqual(found, [
    {
      uuid: '6f1d1c2e0a7b4c55a3e9d4b2c1f00001',
      host: '192.0.2.10',
      name: 'Salon',
      model: 'Haiku H/I Series',
      apiVersion: 5,
    },
  ]);
  assert.deepEqual(parseMdnsResults(undefined), []);
});

test('normalizeUuid keeps a UUID usable in an external id', () => {
  assert.equal(normalizeUuid(' 6F1D1C2E-0A7B '), '6f1d1c2e-0a7b');
  assert.equal(normalizeUuid('a:b'), null);
  assert.equal(normalizeUuid(''), null);
  assert.equal(normalizeUuid(12), null);
});
