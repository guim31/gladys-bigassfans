// -----------------------------------------------------------------------------
// A fake Big Ass Fans device on a real TCP socket (127.0.0.1, random port),
// speaking the i6 protocol of src/baf: SLIP-framed protobuf messages.
//
// Like the firmware as aiobafi6 describes it: a query is answered in several
// messages (one per property group), a commit is applied and its new values
// pushed back, and a change made "on the fan" (remote, app) is pushed to every
// open connection. The properties come from test/fixtures/baf.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { FrameDecoder, frame } from '../../src/baf/slip.js';
import { decodeRoot, encodeQueryResult } from '../../src/baf/proto.js';

const FIXTURES = new URL('../fixtures/baf/', import.meta.url);

export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
}

// How the answer to a query is cut, roughly like the firmware's groups.
const GROUPS = [
  /^(name|model|local_datetime|utc_datetime|firmware_version|mac_address|uuid9|dns_sd_uuid|api_endpoint|api_version|firmware|capabilities)$/,
  /^(fan_mode|reverse_enable|speed|speed_percent|whoosh_enable|eco_enable|auto_comfort_enable|comfort_|motion_sense_|return_to_auto_|target_rpm|current_rpm|fan_occupancy_detected)/,
  /^light_/,
  /^(temperature|humidity)$/,
  /./,
];

export class FakeFan {
  /**
   * @param {string} fixture name of a file of test/fixtures/baf
   * @param {string} [host] the address the fan "has" on the LAN (192.0.2.x)
   */
  constructor(fixture, host) {
    this.fixture = fixture;
    this.properties = loadFixture(fixture);
    this.host = host ?? this.properties.ip_address;
    this.properties.ip_address = this.host;
    this.sockets = new Set();
    this.commits = [];
    this.queries = 0;
    // Test switches: no answer to queries, no push after a commit.
    this.mute = false;
    this.silentCommits = false;
    this.server = null;
    this.port = null;
  }

  get uuid() {
    return this.properties.dns_sd_uuid;
  }

  /** The mDNS record the Gladys core would relay for this fan. */
  mdnsRecord() {
    return {
      name: `${this.properties.name}._api._tcp.local`,
      host: `${this.properties.name}.local`,
      addresses: ['fe80::200:5eff:fe10:1', this.host],
      port: 31415,
      txt: [
        `api version=${this.properties.api_version}`,
        `model=${this.properties.model}`,
        `uuid=${this.properties.dns_sd_uuid}`,
        `name=${this.properties.name}`,
      ],
    };
  }

  async listen(port = 0, address = '127.0.0.1') {
    this.address = address;
    this.server = net.createServer((socket) => this.accept(socket));
    await new Promise((resolve) => this.server.listen(port, address, resolve));
    this.port = this.server.address().port;
    return this;
  }

  /** Switched off at the breaker: connections drop, new ones are refused. */
  async powerOff() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** Back on, on the same port. */
  async powerOn() {
    await this.listen(this.port, this.address);
  }

  accept(socket) {
    this.sockets.add(socket);
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const payload of decoder.push(chunk)) {
        this.handle(socket, decodeRoot(payload));
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
  }

  handle(socket, root) {
    if (root.root2?.query) {
      this.queries += 1;
      if (!this.mute) {
        for (const group of this.groups()) {
          socket.write(frame(encodeQueryResult([group])));
        }
      }
    }
    const commit = root.root2?.commit?.properties;
    if (commit) {
      this.commits.push(commit);
      this.apply(commit, { push: !this.silentCommits });
    }
  }

  groups() {
    const groups = GROUPS.map(() => ({}));
    for (const [key, value] of Object.entries(this.properties)) {
      const index = GROUPS.findIndex((pattern) => pattern.test(key));
      groups[index][key] = value;
    }
    return groups.filter((group) => Object.keys(group).length > 0);
  }

  /** Change properties "on the fan"; pushed to the connections when `push`. */
  apply(changes, { push = true } = {}) {
    const pushed = { ...changes };
    Object.assign(this.properties, changes);
    if (changes.light_brightness_level !== undefined) {
      this.properties.light_brightness_percent = Math.round(
        (changes.light_brightness_level / 16) * 100,
      );
      pushed.light_brightness_percent = this.properties.light_brightness_percent;
    }
    if (push) {
      this.push(pushed);
    }
  }

  push(properties) {
    for (const socket of this.sockets) {
      socket.write(frame(encodeQueryResult([properties])));
    }
  }

  async close() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    if (this.server?.listening) {
      await new Promise((resolve) => this.server.close(resolve));
    }
  }
}
