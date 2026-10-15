// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake fans on real local TCP
// sockets, and a temporary /data, with the integration wired on top through
// registerHandlers. The fans "live" at 192.0.2.x: the socket factory maps each
// address to its fake's port on 127.0.0.1, and any other address to a closed
// port (connection refused, like a switched-off fan). No hub timer runs unless
// asked.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FIXTURE_NAMES, FakeFan } from './fakeFan.js';

// The integration logs every fan found; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HAIKU = 'haiku-hi-downlight-comfort';
export const UPLIGHT = 'haiku-hi-uplight-only';
export const I6 = 'i6-no-light';
export const ES6 = 'es6-basic';
export const LIGHT = 'haiku-l-light';

// Fast links and hub: a missing fan fails in milliseconds.
export const FAST_LINK = {
  connectTimeoutMs: 500,
  queryIntervalMs: 60_000,
  answerTimeoutMs: 2_000,
  firstRetryMs: 20,
  maxRetryMs: 40,
};
export const FAST_HUB = { settleMs: 30, discoveryWaitMs: 2_000 };

/** A port nothing listens on: connections are refused at once. */
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** One fake fan per fixture, at 192.0.2.10, .11... */
export function allFans() {
  return FIXTURE_NAMES.map((name, index) => new FakeFan(name, `192.0.2.${10 + index}`));
}

/**
 * @param {object} [options]
 * @param {FakeFan[]} [options.fans] the fake fans of the network
 * @param {boolean} [options.scan] whether the core's mDNS browse finds them
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's rediscovery timer
 */
export async function createWorld({
  fans = [new FakeFan(HAIKU, '192.0.2.10')],
  scan = true,
  config = { language: 'en' },
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-bigassfans-')),
  timings = {},
  linkTimings = {},
  timers = false,
} = {}) {
  for (const fan of fans) {
    if (!fan.server) {
      await fan.listen();
    }
  }
  const refused = await closedPort();
  const sockets = new Set();
  const createSocket = (host) => {
    const fan = fans.find((candidate) => candidate.host === host);
    const socket = net.createConnection({ host: '127.0.0.1', port: fan ? fan.port : refused });
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const gladys = createFakeGladys({
    config,
    devices: created,
    scanResults: { mdns: scan ? fans.map((fan) => fan.mdnsRecord()) : [] },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    createSocket,
    timers,
    timings: { ...FAST_HUB, ...timings },
    linkTimings: { ...FAST_LINK, ...linkTimings },
  });
  const stop = async () => {
    await app.stop();
    for (const socket of sockets) {
      socket.destroy();
    }
    await Promise.all(fans.map((fan) => fan.close()));
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, fans, app, hub: app.hub, dataDir, stop };
}

export const deviceId = (gladys, uuid) => gladys.externalIds('fan', uuid).device;
export const featureId = (gladys, uuid, key) => gladys.externalIds('fan', uuid).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

/** Wait until `check()` is true (a push travelling through a socket). */
export async function until(check, { timeoutMs = 2_000, stepMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

export { FakeFan, FIXTURE_NAMES };
