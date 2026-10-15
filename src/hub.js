// -----------------------------------------------------------------------------
// The Big Ass Fans hub: finds the fans, keeps one connection open to each,
// publishes their devices and states to Gladys, runs the commands, fires the
// scene trigger and the timed boosts.
//
// Refreshing: the fans push their changes on the open connection (a speed set
// from the remote, the light dimmed from the app, the occupancy sensor), and
// each link queries every property once a minute (src/baf/link.js). Gladys
// never polls these devices (should_poll: false, core issue #3198): onPoll is
// only a fallback that asks for a query.
//
// A fan is identified by the UUID it reports (`dns_sd_uuid`, the one of its
// mDNS announcement), whatever address it answers on.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { FanLink } from './baf/link.js';
import {
  capabilitiesOf,
  isIdentified,
  mergeCapabilities,
  restoreCapabilities,
  SPEED_MAX,
  clamp,
} from './baf/model.js';
import { MODE, mergeProperties } from './baf/proto.js';
import {
  CommandError,
  FEATURE_KEYS,
  applyWrite,
  buildDevice,
  commandFor,
  deviceIds,
  deviceName,
  deviceValues,
  featureSpecs,
} from './devices.js';
import { normalizeUuid, parseMdnsResults, SCAN_TIMEOUT_SECONDS } from './discovery.js';
import { normalizeIpv4 } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, localizedError } from './texts.js';

const logger = createLogger({ name: 'bigassfans' });
const linkLogger = createLogger({ name: 'bigassfans-link' });

export const TRIGGER = 'fan_changed_outside_gladys';
// The trigger `mode` values, from the fan_mode property.
export const MODE_NAMES = { [MODE.OFF]: 'off', [MODE.ON]: 'on', [MODE.AUTO]: 'auto' };

export const HUB_TIMINGS = {
  // New mDNS scan, to follow DHCP changes and find new fans.
  rediscoveryMs: 15 * 60_000,
  // A fan answers a query in several messages: its device is built once
  // they are all in.
  settleMs: 1_500,
  // How long a discovery waits for the fans it just found to answer.
  discoveryWaitMs: 8_000,
  // Failed connections in a row before a known fan is "unreachable".
  unreachableAfter: 2,
  // An unchanged value is published again this often, so Gladys never shows
  // "no recent value" (it does past 48 h).
  heartbeatMs: 6 * 3_600_000,
};

export const BOOST = { defaultSpeed: SPEED_MAX, defaultMinutes: 15, maxMinutes: 720 };

/**
 * Gladys refused a call or did not answer (restart, network, rate limit): a
 * passing condition, unlike a bug in the integration.
 */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

/** "fetch failed (ECONNREFUSED)": the low-level code Node hides in `cause`. */
const describe = (err) => {
  const code = err?.cause?.code ?? err?.code;
  return code && !String(err.message).includes(code) ? `${err.message} (${code})` : err.message;
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A number from a scene field, or `fallback` when it is left empty. */
function numberOr(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class FanHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.createSocket] (host) => net.Socket, for the tests
   * @param {object} [options.linkTimings] LINK_TIMINGS overrides
   * @param {boolean} [options.timers] the rediscovery timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   */
  constructor({ gladys, store, createSocket, linkTimings, timers = true, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.createSocket = createSocket;
    this.linkTimings = linkTimings;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.config = null;
    /** @type {Map<string, object>} device records, by fan UUID */
    this.records = new Map();
    /** @type {Map<string, object>} open connections, by IPv4 address */
    this.sessions = new Map();
    this.pending = new Set();
    this.rediscoveryTimer = null;
    this.discovering = null;
    this.lastScan = { status: 'not-run', found: 0 };
    this.stopped = false;
    // Repeated failures (Gladys refusing, an address that never answers):
    // one line when they start and one when they end.
    this.problems = new ProblemLog(logger);
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.startTimers();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.discover();
    }
    // New devices, or names in another language for the Discovery list.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.rediscoveryTimer);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscover()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.rediscoveryTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.boost?.timer);
      record.boost = null;
    }
    for (const session of this.sessions.values()) {
      this.closeSession(session);
    }
    this.sessions.clear();
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /**
   * A background task failed. Gladys refusing or away is said once until it
   * accepts again; a bug is logged with its stack, once per message.
   */
  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the fan updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the fan updates again');
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [key, saved] of Object.entries(data.devices ?? {})) {
      const uuid = normalizeUuid(key);
      const host = normalizeIpv4(saved?.host);
      const caps = restoreCapabilities(saved?.caps);
      if (!uuid || !host || !caps) {
        continue;
      }
      const record = this.createRecord(uuid, host);
      Object.assign(record, {
        name: typeof saved.name === 'string' ? saved.name : null,
        model: typeof saved.model === 'string' ? saved.model : null,
        firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
        caps,
      });
      this.records.set(uuid, record);
    }
  }

  save() {
    const devices = {};
    for (const record of this.records.values()) {
      if (record.caps) {
        devices[record.uuid] = {
          host: record.host,
          name: record.name,
          model: record.model,
          firmware: record.firmware,
          caps: record.caps,
        };
      }
    }
    return this.store.save({ devices });
  }

  // --- Records and sessions ----------------------------------------------------

  createRecord(uuid, host) {
    return {
      uuid,
      host,
      name: null,
      model: null,
      firmware: null,
      caps: null,
      properties: {},
      session: null,
      // null until the first answer or the first failure.
      reachable: null,
      boost: null,
    };
  }

  /** The connection to `host`, opened if needed. */
  ensureSession(host) {
    let session = this.sessions.get(host);
    if (session) {
      return session;
    }
    const link = new FanLink({
      host,
      createSocket: this.createSocket,
      timings: this.linkTimings,
      logger: linkLogger,
    });
    session = {
      host,
      link,
      properties: {},
      uuid: null,
      record: null,
      settled: false,
      settleTimer: null,
      failures: 0,
      first: deferred(),
    };
    const current = session;
    link.on('connected', () => this.onConnected(current));
    link.on('properties', (list) => this.onProperties(current, list));
    link.on('disconnected', () => this.onDisconnected(current));
    link.on('failed', (err) => this.track(this.onFailed(current, err)));
    this.sessions.set(host, session);
    if (!this.stopped) {
      link.start();
    }
    return session;
  }

  closeSession(session) {
    clearTimeout(session.settleTimer);
    session.link.stop();
    session.link.removeAllListeners();
    session.first.resolve();
  }

  onConnected(session) {
    session.failures = 0;
    // Start from what this connection reports: another fan may answer at the
    // address now (DHCP), its properties must not mix with the old ones.
    session.properties = {};
    // The first answer after a (re)connection is a full snapshot: it settles
    // before anything is announced, and fires no trigger.
    session.settled = false;
  }

  onDisconnected(session) {
    session.settled = false;
    clearTimeout(session.settleTimer);
    session.settleTimer = null;
  }

  onProperties(session, list) {
    const previousMode = session.properties.fan_mode;
    for (const properties of list) {
      mergeProperties(session.properties, properties);
    }
    if (!session.settled) {
      if (!session.settleTimer && isIdentified(session.properties)) {
        session.settleTimer = setTimeout(() => {
          session.settleTimer = null;
          this.track(this.onSettled(session));
        }, this.timings.settleMs);
      }
      return;
    }
    const record = session.record;
    if (record?.session === session) {
      this.track(this.applyUpdate(record, previousMode));
    }
  }

  /** The fan answered in full: identify it, bind its record, announce it. */
  async onSettled(session) {
    try {
      await this.settle(session);
    } finally {
      // A discovery waiting for this fan goes on, even if Gladys refused.
      session.first.resolve();
    }
  }

  async settle(session) {
    if (this.stopped || this.sessions.get(session.host) !== session) {
      return;
    }
    session.settled = true;
    const uuid = normalizeUuid(session.properties.dns_sd_uuid);
    if (!uuid) {
      this.problems.fail(
        `uuid:${session.host}`,
        `The device at ${session.host} answers without a usable UUID: ignored`,
      );
      return;
    }
    this.problems.recover(`uuid:${session.host}`);
    this.problems.recover(
      `host:${session.host}`,
      `A Big Ass Fans device answers at ${session.host}`,
    );
    session.uuid = uuid;

    // Another fan used to answer at this address (DHCP shuffled them).
    if (session.record && session.record.uuid !== uuid) {
      await this.detach(session.record);
    }
    let record = this.records.get(uuid);
    const isNew = !record?.caps;
    if (!record) {
      record = this.createRecord(uuid, session.host);
      this.records.set(uuid, record);
    }
    const previousSession = record.session;
    const moved = !isNew && record.host !== session.host;
    if (moved) {
      logger.info(`${deviceName(record)} moved from ${record.host} to ${session.host}`);
    }
    record.host = session.host;
    record.session = session;
    session.record = record;
    record.properties = session.properties;
    if (previousSession && previousSession !== session) {
      // The old address is no one's now (unless typed in the configuration).
      previousSession.record = null;
      this.dropSessionIfUnused(previousSession.host);
    }

    const props = session.properties;
    const before = {
      name: record.name,
      model: record.model,
      firmware: record.firmware,
      caps: record.caps,
    };
    record.name = typeof props.name === 'string' && props.name.trim() ? props.name : record.name;
    record.model = props.model || record.model;
    record.firmware = props.firmware_version || record.firmware;
    record.caps = mergeCapabilities(record.caps, capabilitiesOf(props));
    const wasReachable = record.reachable;
    record.reachable = true;
    session.failures = 0;

    if (isNew) {
      logger.info(`Found ${deviceName(record)} (${record.model ?? '?'}) at ${record.host}`);
    } else if (wasReachable === false) {
      logger.info(`${deviceName(record)} answers again at ${record.host}`);
    }
    const changed =
      moved ||
      !sameJson(before, {
        name: record.name,
        model: record.model,
        firmware: record.firmware,
        caps: record.caps,
      });
    if (changed) {
      await this.save();
      await this.publishDevices();
    }
    await this.publishStates(record);
    if (wasReachable !== true) {
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
    }
  }

  /** A fan pushed (or answered a periodic query): publish what changed. */
  async applyUpdate(record, previousMode) {
    const caps = mergeCapabilities(record.caps, capabilitiesOf(record.properties));
    if (!sameJson(caps, record.caps)) {
      // A property seen for the first time (a sensor that warmed up).
      record.caps = caps;
      await this.save();
      await this.publishDevices();
    }
    const mode = record.properties.fan_mode;
    if (record.caps.fan && previousMode !== undefined && mode !== previousMode) {
      this.fireChanged(record);
    }
    await this.publishStates(record);
  }

  /** The record lost its address: another fan answers there now. */
  async detach(record) {
    if (record.session) {
      record.session.record = null;
    }
    record.session = null;
    record.properties = {};
    await this.markUnreachable(record);
  }

  async onFailed(session, err) {
    session.failures += 1;
    session.settled = false;
    const record = session.record;
    if (!record) {
      // A typed address with nothing answering: said once.
      this.problems.fail(
        `host:${session.host}`,
        `No Big Ass Fans device answers at ${session.host}: ${describe(err)}`,
      );
      session.first.resolve();
      return;
    }
    session.first.resolve();
    if (record.reachable === null || session.failures >= this.timings.unreachableAfter) {
      await this.markUnreachable(record);
    }
  }

  async markUnreachable(record) {
    if (record.reachable === false || this.stopped) {
      record.reachable = false;
      return;
    }
    record.reachable = false;
    logger.info(`${deviceName(record)} does not answer at ${record.host}`);
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
  }

  /** Close the connection to `host` unless the configuration or a fan needs it. */
  dropSessionIfUnused(host) {
    const typed = this.config?.hosts.includes(host);
    const used = [...this.records.values()].some((record) => record.host === host);
    const session = this.sessions.get(host);
    if (session && !typed && !used) {
      this.closeSession(session);
      this.sessions.delete(host);
    }
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Scan through the Gladys core, then connect to the typed, found and known
   * addresses. Resolves with the number of fans answering.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    for (const found of await this.scan()) {
      let record = this.records.get(found.uuid);
      if (!record) {
        record = this.createRecord(found.uuid, found.host);
        record.name = found.name;
        record.model = found.model;
        this.records.set(found.uuid, record);
      } else if (record.host !== found.host) {
        logger.info(`${deviceName(record)} announces a new address: ${found.host}`);
        record.host = found.host;
      }
    }

    const fresh = [];
    const wanted = new Set(this.config.hosts);
    for (const record of this.records.values()) {
      wanted.add(record.host);
    }
    for (const host of wanted) {
      const existed = this.sessions.has(host);
      const session = this.ensureSession(host);
      if (!existed) {
        fresh.push(session);
      } else if (!session.link.connected) {
        // Retry now rather than at the end of the backoff.
        session.link.reconnect();
      }
    }
    // Bind the records to the connection of their address before it answers,
    // so a failure is theirs.
    for (const record of this.records.values()) {
      const session = this.sessions.get(record.host);
      if (session && !session.record && record.session !== session) {
        session.record = record;
        if (record.session && record.session !== session) {
          record.session.record = null;
        }
        record.session = session;
      }
    }
    for (const host of [...this.sessions.keys()]) {
      if (!wanted.has(host)) {
        this.dropSessionIfUnused(host);
      }
    }

    await this.waitFor(fresh.map((session) => session.first.promise));
    // Known from /data, silent since the start: unreachable.
    for (const record of this.records.values()) {
      if (record.reachable === null && record.caps && !record.session?.link.connected) {
        await this.markUnreachable(record);
      }
    }
    await this.save();
    return [...this.records.values()].filter((record) => record.reachable === true).length;
  }

  /** Wait for the promises, at most discoveryWaitMs. */
  async waitFor(promises) {
    if (promises.length === 0) {
      return;
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, this.timings.discoveryWaitMs);
    });
    await Promise.race([Promise.all(promises), timeout]);
    clearTimeout(timer);
    // The fans that answered in time are announced before the list goes out.
    await this.idle();
  }

  /** One mDNS browse through the Gladys core: `[{ uuid, host, name, model }]`. */
  async scan() {
    try {
      const found = parseMdnsResults(
        await this.gladys.scanNetwork('mdns', { timeoutSeconds: SCAN_TIMEOUT_SECONDS }),
      );
      this.lastScan = { status: 'ok', found: found.length };
      this.problems.recover('scan', 'Big Ass Fans discovery through Gladys works again');
      return found;
    } catch (err) {
      // 403: a core without mediated discovery; 409 or 429: a scan is
      // already running. The typed and known addresses still work.
      const status = err.status === 429 || err.status === 409 ? 'busy' : 'unavailable';
      const message = `Big Ass Fans discovery through Gladys failed: ${describe(err)}`;
      if (status === 'busy') {
        logger.debug(message);
      } else {
        this.problems.fail('scan', message);
      }
      this.lastScan = { status, found: 0 };
      return [];
    }
  }

  async rediscover() {
    await this.discover();
    // New fans, and new addresses (DHCP) for the params of the created devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => record.caps)
      .map((record) => buildDevice(this.gladys, record, this.language));
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record?.caps) {
      throw localizedError('unknownDevice', this.language);
    }
    return record;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record.uuid).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish the values of one fan, if the user created it: the SDK sends only
   * those that changed (Gladys caps states at 300 a minute and re-evaluates
   * scenes on each one), and an unchanged one every heartbeatMs.
   */
  async publishStates(record) {
    if (!record.caps || !this.isCreated(record)) {
      return;
    }
    const ids = deviceIds(this.gladys, record.uuid);
    const values = deviceValues(record);
    const states = featureSpecs(record.caps, this.language)
      .filter((spec) => values[spec.key] !== undefined)
      .map((spec) => ({
        device_feature_external_id: ids.feature(spec.key),
        state: values[spec.key],
      }));
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    await this.publishTransports([record]);
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => record.caps && this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.uuid).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()].filter((record) => record.caps);
    if (records.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noDevice);
    } else if (!records.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  /** onPoll fallback: ask the fan for every property. */
  refresh(record) {
    record.session?.link.query();
  }

  fireChanged(record) {
    if (!this.isCreated(record)) {
      return;
    }
    const { fan_mode: mode, speed } = record.properties;
    this.track(
      this.gladys.publishSceneEvent(TRIGGER, {
        device: deviceIds(this.gladys, record.uuid).device,
        mode: MODE_NAMES[mode] ?? 'unknown',
        speed: mode === MODE.OFF || typeof speed !== 'number' ? 0 : speed,
      }),
    );
  }

  // --- Commands ----------------------------------------------------------------

  /**
   * Write properties to a fan, one commit each, then publish what it will
   * show without waiting for its push. Resolves once written.
   */
  async write(record, writes) {
    const link = record.session?.link;
    if (!link?.connected) {
      link?.reconnect();
      throw localizedError('unreachable', this.language);
    }
    for (const write of writes) {
      if (!link.commit(write)) {
        throw localizedError('unreachable', this.language);
      }
      // The push that confirms it then changes nothing: no trigger fires
      // for a command of Gladys.
      Object.assign(record.properties, applyWrite(record.properties, write));
    }
    await this.publishStates(record);
  }

  /** A Gladys command on a feature of one of the fans. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    let writes;
    try {
      writes = commandFor(record, key, value);
    } catch (err) {
      if (err instanceof CommandError && err.code === 'unsupported') {
        throw localizedError('unsupported', this.language);
      }
      throw err;
    }
    logger.info(`${deviceName(record)}: ${key} set to ${value}`);
    if (writes.length === 0) {
      // Nothing to change (auto mode turned off while not in auto): show the
      // real state back.
      this.gladys.forgetPublishedStates(feature.external_id);
      await this.publishStates(record);
      return;
    }
    if (key === FEATURE_KEYS.FAN || key === FEATURE_KEYS.FAN_AUTO || key === FEATURE_KEYS.SPEED) {
      // The user took the fan over: a running boost does not restore.
      this.cancelBoost(record);
    }
    await this.write(record, writes);
  }

  /**
   * Run a fan at `speed` for `minutes`, then put it back as it was (off, on
   * at its speed, or auto) — unless someone changed it meanwhile. A new boost
   * replaces the running one and keeps its original state to restore.
   * @returns {{ previous: object, until: Date }}
   */
  async boost(deviceExternalId, { speed, minutes } = {}) {
    const record = this.require(deviceExternalId);
    if (!record.caps.fan) {
      throw localizedError('noFan', this.language);
    }
    const level = clamp(Math.round(numberOr(speed, BOOST.defaultSpeed)), 1, SPEED_MAX);
    const duration = clamp(
      Math.round(numberOr(minutes, BOOST.defaultMinutes)),
      1,
      BOOST.maxMinutes,
    );
    const props = record.properties;
    const previous = record.boost?.previous ?? { mode: props.fan_mode, speed: props.speed };
    this.cancelBoost(record);
    await this.write(record, commandFor(record, FEATURE_KEYS.SPEED, level));
    const until = new Date(Date.now() + duration * 60_000);
    record.boost = {
      previous,
      speed: level,
      timer: setTimeout(() => this.track(this.endBoost(record)), duration * 60_000),
    };
    logger.info(`${deviceName(record)}: boost at speed ${level} for ${duration} min`);
    return { previous, until };
  }

  cancelBoost(record) {
    clearTimeout(record.boost?.timer);
    record.boost = null;
  }

  async endBoost(record) {
    const boost = record.boost;
    record.boost = null;
    if (!boost || this.stopped) {
      return;
    }
    const props = record.properties;
    if (props.fan_mode !== MODE.ON || props.speed !== boost.speed) {
      logger.debug(`${deviceName(record)}: changed during the boost, nothing restored`);
      return;
    }
    const { mode, speed } = boost.previous;
    let writes;
    if (mode === MODE.OFF || mode === MODE.AUTO) {
      writes = [{ fan_mode: mode }];
    } else if (mode === MODE.ON && typeof speed === 'number' && speed >= 1) {
      writes = [{ speed: clamp(speed, 1, SPEED_MAX) }];
    } else {
      // State unknown before the boost: leave it running.
      return;
    }
    try {
      await this.write(record, writes);
      logger.info(`${deviceName(record)}: boost over, back to ${MODE_NAMES[mode]}`);
    } catch (err) {
      logger.warn(`${deviceName(record)}: cannot end the boost: ${err.message}`);
    }
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      scan: this.lastScan.status,
      invalidHosts: this.config.invalidHosts,
      // Typed addresses where no fan answered.
      silentHosts: this.config.hosts.filter((host) => !this.sessions.get(host)?.uuid),
      devices: [...this.records.values()]
        .filter((record) => record.caps)
        .map((record) => ({
          name: deviceName(record),
          host: record.host,
          model: record.model,
          reachable: record.reachable === true,
        })),
    };
  }
}
