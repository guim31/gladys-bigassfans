#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Big Ass Fans device, with the integration's own
// code (src/baf): connects to <ip>:31415, sends ONE query for every property,
// prints what the fan answered and the Gladys device the integration would
// build from it, then disconnects. It never writes anything to the fan.
//
//   node scripts/probe.mjs 192.168.1.50 [--seconds 5] [--raw]
//
// Nothing private is printed: the MAC address, the UUID and the Wi-Fi name are
// masked, the IP address the fan reports is not shown.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { FrameDecoder, frame } from '../src/baf/slip.js';
import { decodeProperties, encodeQuery, mergeProperties } from '../src/baf/proto.js';
import { BAF_PORT } from '../src/baf/link.js';
import { capabilitiesOf, isIdentified } from '../src/baf/model.js';
import { deviceValues, featureSpecs } from '../src/devices.js';
import { normalizeIpv4 } from '../src/config.js';

const args = process.argv.slice(2);
const host = normalizeIpv4(args.find((arg) => !arg.startsWith('--')));
const seconds = Number(args[args.indexOf('--seconds') + 1]) || 5;
const raw = args.includes('--raw');

if (!host) {
  console.error('Usage: node scripts/probe.mjs <IPv4 address> [--seconds 5] [--raw]');
  process.exit(2);
}

const mask = (value) =>
  typeof value === 'string' && value.length > 4
    ? `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
    : value;

function sanitize(properties) {
  const copy = structuredClone(properties);
  for (const key of ['mac_address', 'dns_sd_uuid', 'uuid9']) {
    copy[key] = mask(copy[key]);
  }
  for (const nested of ['firmware', 'remote_firmware']) {
    if (copy[nested]?.mac_address) {
      copy[nested].mac_address = mask(copy[nested].mac_address);
    }
  }
  if (copy.wifi?.ssid) {
    copy.wifi.ssid = '(hidden)';
  }
  delete copy.ip_address;
  delete copy.api_endpoint;
  return copy;
}

const properties = {};
let messages = 0;
const decoder = new FrameDecoder();
const socket = net.createConnection({ host, port: BAF_PORT });
socket.setTimeout(10_000);

socket.on('connect', () => {
  console.log(`Connected to ${host}:${BAF_PORT}, query sent, listening ${seconds} s...`);
  socket.write(frame(encodeQuery()));
  setTimeout(() => socket.end(), seconds * 1000);
});
socket.on('data', (chunk) => {
  for (const payload of decoder.push(chunk)) {
    messages += 1;
    for (const set of decodeProperties(payload)) {
      mergeProperties(properties, set);
    }
  }
});
socket.on('timeout', () => socket.destroy(new Error('no connection after 10 s')));
socket.on('error', (err) => {
  console.error(`Cannot talk to ${host}:${BAF_PORT}: ${err.message}`);
  process.exitCode = 1;
});
socket.on('close', () => {
  if (messages === 0) {
    console.error('No message received: is it a Big Ass Fans device with firmware 3.0 or later?');
    process.exitCode = 1;
    return;
  }
  const caps = capabilitiesOf(properties);
  console.log(`\n${messages} message(s) received. Identified: ${isIdentified(properties)}`);
  console.log(`Name: ${properties.name ?? '?'} — model: ${properties.model ?? '?'}`);
  console.log(
    `Firmware: ${properties.firmware_version ?? '?'} — API version: ${properties.api_version ?? '?'}`,
  );
  console.log('Capabilities:', JSON.stringify(caps));
  const values = deviceValues({ caps, properties });
  console.log('\nGladys features the integration would create:');
  for (const spec of featureSpecs(caps, 'en')) {
    const unit = spec.unit ? ` ${spec.unit}` : '';
    console.log(
      `  - ${spec.key.padEnd(18)} ${`${spec.category}/${spec.type}`.padEnd(30)} [${spec.min}..${spec.max}]${unit} = ${values[spec.key] ?? '(no value)'}`,
    );
  }
  if (raw) {
    console.log('\nProperties (private values masked):');
    console.log(JSON.stringify(sanitize(properties), null, 2));
  }
});
