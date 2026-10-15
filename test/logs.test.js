// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the fans
// and of Gladys, never one line per push or query, and a repeated failure
// once. Also: the states refresh by the integration's own timer, without any
// onPoll, and nothing private the fans report ends up in the logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { MODE } from '../src/baf/proto.js';
import { FEATURE_KEYS as K } from '../src/devices.js';
import { FakeFan, HAIKU, createAll, createWorld, featureId, until } from './helpers/world.js';

const SALON = '6f1d1c2e0a7b4c55a3e9d4b2c1f00001';

// A line of the SDK logger: "[2026-10-15T21:40:12.000Z] [INFO] [name] ...".
const LOG_LINE = /^\[\d{4}-\d\d-\d\dT/;

/**
 * Every log line written on stdout and stderr while `fn` runs, at `level`.
 * Anything else (the test runner reports through stdout too) passes through.
 */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const original = { stdout: process.stdout.write, stderr: process.stderr.write };
  const writer = (stream) =>
    function write(chunk, ...rest) {
      if (typeof chunk === 'string' && LOG_LINE.test(chunk)) {
        lines.push(...chunk.split('\n').filter(Boolean));
        return true;
      }
      return original[stream].call(process[stream], chunk, ...rest);
    };
  const stdout = t.mock.method(process.stdout, 'write', writer('stdout'));
  const stderr = t.mock.method(process.stderr, 'write', writer('stderr'));
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.stop());
  await createAll(world);
  return world;
}

const lastState = (world, key) => world.fake.lastState(featureId(world.gladys, SALON, key));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('logs: pushes, queries and rediscoveries write nothing at the info level', async (t) => {
  const world = await createdWorld(t);
  const [fan] = world.fans;
  const lines = await capture(t, async () => {
    for (const speed of [4, 5, 6, 6]) {
      fan.apply({ speed });
      await until(() => lastState(world, K.SPEED) === speed);
    }
    fan.apply({ fan_occupancy_detected: false, temperature: 2000 });
    await until(() => lastState(world, K.TEMPERATURE) === 20);
    world.hub.refresh(world.hub.records.get(SALON));
    await pause(30);
    await world.hub.rediscover();
    await world.hub.idle();
  });
  assert.deepEqual(lines, []);
});

test('logs: one line per user action', async (t) => {
  const world = await createdWorld(t);
  const device = world.fake.discoveredDevices[0];
  const feature = device.features.find((entry) => entry.external_id.endsWith(':speed'));
  const lines = await capture(t, async () => {
    await world.fake.setValue(device, feature, 2);
    await pause(30);
    await world.hub.idle();
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Salon: speed set to 2/);
});

test('logs: Gladys refusing the states is said once, and its return once', async (t) => {
  const world = await createdWorld(t);
  const [fan] = world.fans;
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const speed of [1, 2, 4, 5]) {
      fan.apply({ speed });
      await pause(20);
      await world.hub.idle();
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Gladys does not take the fan updates: Gladys is restarting/);

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.rediscover();
    fan.apply({ speed: 6 });
    await until(() => lastState(world, K.SPEED) === 6);
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the fan updates again/);
});

test('logs: a typed address that never answers is said once, its fan once when it comes', async (t) => {
  const fan = new FakeFan(HAIKU, '192.0.2.30');
  await fan.listen();
  await fan.powerOff();
  const world = await createWorld({
    fans: [fan],
    scan: false,
    linkTimings: { firstRetryMs: 10, maxRetryMs: 10 },
  });
  t.after(() => world.stop());
  const failing = await capture(t, async () => {
    await world.fake.configUpdated({ hosts: '192.0.2.30', language: 'en' });
    await pause(100);
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*No Big Ass Fans device answers at 192\.0\.2\.30/);

  const back = await capture(t, async () => {
    await fan.powerOn();
    await until(() => world.fake.discoveredDevices.length === 1);
  });
  assert.equal(back.length, 2, back.join('\n'));
  assert.match(back[0], /\[INFO\].*A Big Ass Fans device answers at 192\.0\.2\.30/);
  assert.match(back[1], /\[INFO\].*Found Salon \(Haiku H\/I Series\) at 192\.0\.2\.30/);
});

test('logs: a fan lost and back is one line each, not one per retry', async (t) => {
  const world = await createdWorld(t, { linkTimings: { firstRetryMs: 10, maxRetryMs: 10 } });
  const [fan] = world.fans;
  const lines = await capture(t, async () => {
    await fan.powerOff();
    await until(() => world.fake.transports.at(-1).transport === 'unreachable');
    await pause(100);
    await fan.powerOn();
    await until(() => world.fake.transports.at(-1).transport === 'local');
  });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Salon does not answer at 192\.0\.2\.10/);
  assert.match(lines[1], /\[INFO\].*Salon answers again at 192\.0\.2\.10/);
});

test('logs: a core without mediated discovery is said once; a busy scan is not a warning', async (t) => {
  const world = await createdWorld(t);
  const scan = t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network_discovery not declared');
  });
  const refused = await capture(t, async () => {
    for (let round = 0; round < 3; round += 1) {
      await world.hub.track(world.hub.rediscover());
    }
  });
  assert.equal(refused.length, 1, refused.join('\n'));
  assert.match(refused[0], /\[WARN\].*Big Ass Fans discovery through Gladys failed/);

  scan.mock.mockImplementation(async () => {
    throw new GladysApiError(409, 'CONFLICT', 'A scan is already running');
  });
  const busy = await capture(t, async () => {
    await world.hub.track(world.hub.rediscover());
  });
  assert.deepEqual(busy, []);
  assert.equal(world.hub.summary().scan, 'busy');
});

test('logs: a bug in a background task is logged with its stack, not hidden', async (t) => {
  const world = await createdWorld(t);
  t.mock.method(world.hub, 'publishTransports', async () => {
    throw new RangeError('a bug');
  });
  const lines = await capture(t, async () => {
    await world.hub.track(world.hub.rediscover());
  });
  const text = lines.join('\n');
  assert.match(text, /\[ERROR\].*Background task failed/);
  assert.match(text, /RangeError: a bug\n\s+at /);
});

test('logs: the Wi-Fi name and the MAC address of a fan never appear, even in debug', async (t) => {
  const lines = await capture(
    t,
    async () => {
      const world = await createdWorld(t);
      const [fan] = world.fans;
      fan.apply({ fan_mode: MODE.OFF });
      await until(() => world.fake.sceneEvents.length === 1);
      await world.fake.action('search', {});
      await world.stop();
    },
    'debug',
  );
  assert.ok(lines.length > 0, 'the debug level writes something');
  const text = lines.join('\n');
  assert.doesNotMatch(text, /example-network/);
  assert.doesNotMatch(text, /02:00:5e:10:00:01/i);
});

test('refresh: the states follow the fan by the integration own timer, without onPoll', async (t) => {
  // Only the intervals are simulated: the sockets and the settling keep their
  // real timers.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const world = await createdWorld(t);
  const [fan] = world.fans;
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  const polls = t.mock.method(world.hub, 'refresh');
  // A change the fan does not push.
  fan.apply({ speed: 5, temperature: 2500 }, { push: false });
  await pause(30);
  assert.equal(lastState(world, K.SPEED), 3);

  t.mock.timers.tick(59_000);
  await pause(30);
  assert.equal(lastState(world, K.SPEED), 3, 'not before the interval');

  // The link queries every property once a minute.
  t.mock.timers.tick(1_000);
  await until(() => lastState(world, K.SPEED) === 5);
  assert.equal(lastState(world, K.TEMPERATURE), 25);
  assert.equal(polls.mock.callCount(), 0, 'onPoll was never needed');
});
