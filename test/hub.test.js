// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys on one side, fake fans on
// real TCP sockets on the other (test/helpers/fakeFan.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODE } from '../src/baf/proto.js';
import { FEATURE_KEYS as K } from '../src/devices.js';
import { TRIGGER } from '../src/hub.js';
import {
  ES6,
  FakeFan,
  HAIKU,
  I6,
  LIGHT,
  createAll,
  createWorld,
  deviceId,
  featureId,
  until,
} from './helpers/world.js';

const SALON = '6f1d1c2e0a7b4c55a3e9d4b2c1f00001'; // HAIKU
const ATELIER = '6f1d1c2e0a7b4c55a3e9d4b2c1f00003'; // I6

async function created(t, options) {
  const world = await createWorld(options);
  t.after(() => world.stop());
  await createAll(world);
  return world;
}

const deviceOf = (world, uuid) =>
  world.fake.discoveredDevices.find(
    (device) => device.external_id === deviceId(world.gladys, uuid),
  );
const featureOf = (world, uuid, key) =>
  deviceOf(world, uuid).features.find(
    (feature) => feature.external_id === featureId(world.gladys, uuid, key),
  );
const state = (world, uuid, key) => world.fake.lastState(featureId(world.gladys, uuid, key));
const set = (world, uuid, key, value) =>
  world.fake.setValue(deviceOf(world, uuid), featureOf(world, uuid, key), value);

test('discovery: the fans the core finds in mDNS are published with their own name', async (t) => {
  const world = await createWorld({
    fans: [new FakeFan(HAIKU, '192.0.2.10'), new FakeFan(I6, '192.0.2.11')],
  });
  t.after(() => world.stop());
  assert.deepEqual(world.fake.scans, [{ type: 'mdns', timeout_seconds: 5 }]);
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.model, device.should_poll]),
    [
      ['Salon', 'Haiku H/I Series', false],
      ['Atelier', 'i6', false],
    ],
  );
  assert.deepEqual(deviceOf(world, SALON).params, [
    { name: 'IP_ADDRESS', value: '192.0.2.10' },
    { name: 'FIRMWARE', value: '3.1.1' },
  ]);
  // English names (the world's configuration).
  assert.equal(featureOf(world, SALON, K.SPEED).name, 'Speed');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // Nothing is created yet: no state sent.
  assert.equal(world.fake.states.length, 0);
});

test('discovery: a typed address works without the core scan', async (t) => {
  const world = await createWorld({
    fans: [new FakeFan(ES6, '192.0.2.20')],
    scan: false,
    config: { hosts: '192.0.2.20, 192.0.2.99, nonsense', language: 'fr' },
  });
  t.after(() => world.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Bureau'],
  );
  assert.equal(featureOf(world, '6f1d1c2e0a7b4c55a3e9d4b2c1f00004', K.FAN).name, 'Ventilateur');
  const ack = await world.fake.action('search', {});
  assert.equal(ack.success, true);
  const { message } = ack.data;
  assert.match(message.fr, /1 appareil\(s\), 1 répondent : Bureau \(192\.0\.2\.20, es6\)/);
  assert.match(message.en, /No answer at 192\.0\.2\.99\. Ignored addresses: nonsense\./);
});

test('discovery: no fan at all is said in the connection status', async (t) => {
  const world = await createWorld({ fans: [], scan: false });
  t.after(() => world.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Aucun appareil Big Ass Fans trouvé/);
});

test('created: every value is published, and again after a re-creation', async (t) => {
  const world = await created(t);
  assert.equal(state(world, SALON, K.FAN), 1);
  assert.equal(state(world, SALON, K.SPEED), 3);
  assert.equal(state(world, SALON, K.TEMPERATURE), 22.2);
  assert.equal(state(world, SALON, K.OCCUPANCY), 1);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceId(world.gladys, SALON),
    transport: 'local',
  });
  // Gladys drops the states of features it does not have yet: a device
  // deleted and added again gets them all again.
  const count = world.fake.states.length;
  await world.fake.deviceCreated(deviceOf(world, SALON));
  await world.hub.idle();
  assert.equal(world.fake.states.length, count * 2);
});

test('commands: Gladys writes, the fan confirms, no trigger fires', async (t) => {
  const world = await created(t, { fans: [new FakeFan(I6, '192.0.2.11')] });
  const [fan] = world.fans;
  assert.deepEqual(await set(world, ATELIER, K.SPEED, 5), { success: true });
  await until(() => fan.commits.length === 2);
  assert.deepEqual(fan.commits, [{ fan_mode: MODE.ON }, { speed: 5 }]);
  assert.equal(state(world, ATELIER, K.FAN), 1);
  assert.equal(state(world, ATELIER, K.SPEED), 5);

  await set(world, ATELIER, K.DIRECTION, 1);
  await set(world, ATELIER, K.WHOOSH, 0);
  await set(world, ATELIER, K.FAN_AUTO, 1);
  await until(() => fan.commits.length === 5);
  assert.deepEqual(fan.commits.slice(2), [
    { reverse_enable: true },
    { whoosh_enable: false },
    { fan_mode: MODE.AUTO },
  ]);
  assert.equal(state(world, ATELIER, K.FAN_AUTO), 1);
  assert.equal(state(world, ATELIER, K.FAN), 0);
  // The pushes that confirm the commands come back: still no trigger.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await world.hub.idle();
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('commands: the light, its brightness and its white', async (t) => {
  const world = await created(t, { fans: [new FakeFan(LIGHT, '192.0.2.14')] });
  const uuid = '6f1d1c2e0a7b4c55a3e9d4b2c1f00005';
  const [fan] = world.fans;
  await set(world, uuid, K.BRIGHTNESS, 30);
  await set(world, uuid, K.COLOR_TEMPERATURE, 2700);
  await until(() => fan.commits.length === 3);
  assert.deepEqual(fan.commits, [
    { light_mode: MODE.ON },
    { light_brightness_level: 5 },
    { light_color_temperature: 2700 },
  ]);
  assert.equal(state(world, uuid, K.LIGHT), 1);
  assert.equal(state(world, uuid, K.BRIGHTNESS), 31);
  assert.equal(state(world, uuid, K.COLOR_TEMPERATURE), 2700);
});

test('commands: an unknown device or a missing feature is refused in the configured language', async (t) => {
  const world = await created(t, { config: { language: 'de' } });
  const ack = await world.fake.setValue(
    { external_id: deviceId(world.gladys, 'nobody-0000') },
    { external_id: `${deviceId(world.gladys, 'nobody-0000')}:fan` },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /Unbekanntes Big-Ass-Fans-Gerät/);
  const device = deviceOf(world, SALON);
  const missing = await world.fake.setValue(
    device,
    { external_id: `${device.external_id}:temperature` },
    20,
  );
  assert.match(missing.error, /hat diese Funktion nicht/);
});

test('pushes: a change from the remote is published and fires the trigger', async (t) => {
  const world = await created(t);
  const [fan] = world.fans;
  fan.apply({ fan_mode: MODE.OFF });
  await until(() => world.fake.sceneEvents.length === 1);
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGER, data: { device: deviceId(world.gladys, SALON), mode: 'off', speed: 0 } },
  ]);
  assert.equal(state(world, SALON, K.FAN), 0);
  assert.equal(state(world, SALON, K.SPEED), 0);

  // A change that is not the mode (the speed, the light): published, no trigger.
  fan.apply({ fan_mode: MODE.ON, speed: 6 });
  await until(() => state(world, SALON, K.SPEED) === 6);
  fan.apply({ light_mode: MODE.ON, temperature: 2301, fan_occupancy_detected: false });
  await until(() => state(world, SALON, K.TEMPERATURE) === 23);
  await world.hub.idle();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => event.data.mode),
    ['off', 'on'],
  );
  assert.equal(world.fake.sceneEvents[1].data.speed, 6);
  assert.equal(state(world, SALON, K.LIGHT), 1);
  assert.equal(state(world, SALON, K.OCCUPANCY), 0);
});

test('pushes: a fan not created in Gladys fires nothing and sends no state', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  world.fans[0].apply({ fan_mode: MODE.OFF });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await world.hub.idle();
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.fake.states.length, 0);
});

test('reachability: a fan switched off is unreachable, then answers again', async (t) => {
  const world = await created(t);
  const [fan] = world.fans;
  await fan.powerOff();
  await until(() => world.fake.transports.at(-1).transport === 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);
  // A command meanwhile fails with a clear message.
  const ack = await set(world, SALON, K.FAN, 1);
  assert.match(ack.error, /does not answer/);

  fan.properties.speed = 2;
  await fan.powerOn();
  await until(() => world.fake.transports.at(-1).transport === 'local');
  await until(() => state(world, SALON, K.SPEED) === 2);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // Changes seen while it was away fire no trigger.
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('restart: the fans known from /data are listed even when switched off', async (t) => {
  const first = await createWorld();
  await first.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'bigassfans-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.devices), [SALON]);
  assert.equal(saved.devices[SALON].host, '192.0.2.10');

  // Back without the fan on the network, and without the core scan.
  const world = await createWorld({ fans: [], scan: false, dataDir: first.dataDir });
  t.after(() => world.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Salon'],
  );
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /No Big Ass Fans device answers/);
});

test('DHCP: a fan announcing a new address is followed', async (t) => {
  const fan = new FakeFan(HAIKU, '192.0.2.10');
  const world = await created(t, { fans: [fan] });
  fan.host = '192.0.2.40';
  await fan.powerOff();
  await fan.powerOn();
  world.fake.scanResults.mdns = [fan.mdnsRecord()];
  await world.fake.scanRequest();
  await until(() => deviceOf(world, SALON).params[0].value === '192.0.2.40');
  await until(() => world.fake.transports.at(-1).transport === 'local');
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('boost: runs the fan, then puts it back as it was', async (t) => {
  const world = await created(t, { fans: [new FakeFan(I6, '192.0.2.11')] });
  const [fan] = world.fans;
  // Only the boost timer is simulated, once the fans have answered.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const device = deviceId(world.gladys, ATELIER);
  const ack = await world.fake.sceneAction('boost', { device, speed: 6, minutes: 10 });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.outputs.until, /^\d{4}-\d\d-\d\dT/);
  assert.equal(state(world, ATELIER, K.SPEED), 6);
  t.mock.timers.tick(10 * 60_000);
  await world.hub.idle();
  // Off before the boost: off again.
  assert.equal(state(world, ATELIER, K.FAN), 0);
  t.mock.timers.reset();
  await until(() => fan.commits.length === 3);
  assert.deepEqual(fan.commits, [{ fan_mode: MODE.ON }, { speed: 6 }, { fan_mode: MODE.OFF }]);
});

test('boost: a user who takes the fan over keeps it', async (t) => {
  const world = await created(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const device = deviceId(world.gladys, SALON);
  await world.fake.sceneAction('boost', { device });
  assert.equal(state(world, SALON, K.SPEED), 7);
  await set(world, SALON, K.SPEED, 4);
  t.mock.timers.tick(15 * 60_000);
  await world.hub.idle();
  assert.equal(state(world, SALON, K.SPEED), 4);
  t.mock.timers.reset();
});

test('boost: refused on a light without fan', async (t) => {
  const world = await created(t, { fans: [new FakeFan(LIGHT, '192.0.2.14')] });
  const ack = await world.fake.sceneAction('boost', {
    device: deviceId(world.gladys, '6f1d1c2e0a7b4c55a3e9d4b2c1f00005'),
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /has no fan/);
});

test('language: the feature names follow the configuration', async (t) => {
  const world = await createWorld({ config: { language: 'es' } });
  t.after(() => world.stop());
  assert.equal(featureOf(world, SALON, K.WHOOSH).name, 'Whoosh (brisa natural)');
  await world.fake.configUpdated({ language: 'de' });
  assert.equal(featureOf(world, SALON, K.WHOOSH).name, 'Whoosh (natürliche Brise)');
});

test('onPoll is only a fallback: it asks the fan for a query', async (t) => {
  const world = await created(t);
  const [fan] = world.fans;
  const before = fan.queries;
  assert.deepEqual(await world.fake.poll(deviceOf(world, SALON)), { success: true });
  await until(() => fan.queries === before + 1);
});
