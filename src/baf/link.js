// -----------------------------------------------------------------------------
// One TCP connection to one Big Ass Fans device (port 31415), kept open.
//
// Like aiobafi6: the link sends a query for every property when it connects
// and then at a fixed interval, and the fan pushes its changes (a speed set
// from the remote, the light dimmed from the app...) on the same connection
// as they happen. A lost or silent connection is closed and opened again
// with a growing delay. The link only moves bytes: the hub (src/hub.js)
// interprets the properties.
//
// Events: 'connected', 'properties' (list of property sets of one message),
// 'disconnected' (error|null), 'failed' (error: the connection could not be
// opened).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { FrameDecoder, frame } from './slip.js';
import { decodeProperties, encodeCommit, encodeQuery } from './proto.js';

export const BAF_PORT = 31415;

export const LINK_TIMINGS = {
  connectTimeoutMs: 10_000,
  // A full query every minute, as aiobafi6 does by default: it refreshes the
  // values a fan does not push (the RPM, the sensors on some firmware) and
  // proves the connection still works.
  queryIntervalMs: 60_000,
  // A query left without any answer this long means a dead connection.
  answerTimeoutMs: 15_000,
  firstRetryMs: 2_000,
  maxRetryMs: 60_000,
};

/** @param {string} host */
export function defaultCreateSocket(host) {
  return net.createConnection({ host, port: BAF_PORT });
}

export class FanLink extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host IPv4 address of the fan
   * @param {(host: string) => import('node:net').Socket} [options.createSocket]
   * @param {object} [options.timings] LINK_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({ host, createSocket = defaultCreateSocket, timings, logger }) {
    super();
    this.host = host;
    this.createSocket = createSocket;
    this.timings = { ...LINK_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.connected = false;
    this.stopped = true;
    this.retryMs = this.timings.firstRetryMs;
    this.retryTimer = null;
    this.queryTimer = null;
    this.answerTimer = null;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.close();
  }

  /** Reconnect now (a new address, a command on a link waiting to retry). */
  reconnect() {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryMs = this.timings.firstRetryMs;
    if (!this.socket) {
      this.open();
    }
  }

  open() {
    const decoder = new FrameDecoder();
    let socket;
    try {
      socket = this.createSocket(this.host);
    } catch (err) {
      this.fail(err);
      return;
    }
    this.socket = socket;
    socket.setNoDelay?.(true);
    socket.setTimeout?.(this.timings.connectTimeoutMs);
    let opened = false;

    socket.once('connect', () => {
      opened = true;
      socket.setTimeout?.(0);
      socket.setKeepAlive?.(true, 30_000);
      this.connected = true;
      this.retryMs = this.timings.firstRetryMs;
      this.logger?.debug(`Connected to ${this.host}`);
      this.emit('connected');
      this.query();
      clearInterval(this.queryTimer);
      this.queryTimer = setInterval(() => this.query(), this.timings.queryIntervalMs);
    });

    socket.on('data', (chunk) => {
      clearTimeout(this.answerTimer);
      this.answerTimer = null;
      let payloads;
      try {
        payloads = decoder.push(chunk);
      } catch (err) {
        this.logger?.debug(`${this.host}: ${err.message}, reconnecting`);
        socket.destroy(err);
        return;
      }
      for (const payload of payloads) {
        let properties;
        try {
          properties = decodeProperties(payload);
        } catch (err) {
          this.logger?.debug(`${this.host}: undecodable message skipped (${err.message})`);
          continue;
        }
        if (properties.length > 0) {
          this.emit('properties', properties);
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy(new Error(`no connection after ${this.timings.connectTimeoutMs} ms`));
    });

    socket.on('error', (err) => {
      // 'close' follows and decides.
      socket.lastError = err;
    });

    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.connected = false;
      clearInterval(this.queryTimer);
      clearTimeout(this.answerTimer);
      this.queryTimer = null;
      this.answerTimer = null;
      if (opened) {
        this.logger?.debug(`Connection to ${this.host} closed`);
        this.emit('disconnected', socket.lastError ?? null);
        // A fan restarting or a Wi-Fi hiccup: try again soon.
        this.schedule(this.timings.firstRetryMs);
      } else {
        this.fail(socket.lastError ?? new Error('connection closed'));
      }
    });
  }

  fail(err) {
    this.socket = null;
    this.connected = false;
    this.logger?.debug(`Cannot connect to ${this.host}: ${err.message}`);
    this.emit('failed', err);
    this.schedule(this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.timings.maxRetryMs);
  }

  schedule(delayMs) {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && !this.socket) {
        this.open();
      }
    }, delayMs);
  }

  close() {
    const { socket } = this;
    this.socket = null;
    this.connected = false;
    clearInterval(this.queryTimer);
    clearTimeout(this.answerTimer);
    this.queryTimer = null;
    this.answerTimer = null;
    socket?.destroy();
  }

  write(payload) {
    if (!this.connected || !this.socket) {
      return false;
    }
    this.socket.write(frame(payload));
    return true;
  }

  /** Ask for every property; false when not connected. */
  query() {
    const sent = this.write(encodeQuery());
    if (sent && !this.answerTimer) {
      const socket = this.socket;
      this.answerTimer = setTimeout(() => {
        this.answerTimer = null;
        socket.destroy(new Error(`no answer within ${this.timings.answerTimeoutMs} ms`));
      }, this.timings.answerTimeoutMs);
    }
    return sent;
  }

  /** Write properties; false when not connected. */
  commit(properties) {
    return this.write(encodeCommit(properties));
  }
}
