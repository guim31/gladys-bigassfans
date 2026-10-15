#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Runs a fake Big Ass Fans device (the one of the tests) on 127.0.0.1, to try
// scripts/probe.mjs or the integration without a fan:
//
//   node scripts/fake-fan.mjs [fixture] [port]
//
// fixture: a file name of test/fixtures/baf without .json (default: the Haiku
// with downlight); port: 31415 by default. FAKE_FAN_ADDRESS=0.0.0.0 makes it
// reachable from another host or container. Ctrl+C stops it.
// -----------------------------------------------------------------------------

import { FIXTURE_NAMES, FakeFan } from '../test/helpers/fakeFan.js';

const [fixture = 'haiku-hi-downlight-comfort', port = '31415'] = process.argv.slice(2);
if (!FIXTURE_NAMES.includes(fixture)) {
  console.error(`Unknown fixture "${fixture}": ${FIXTURE_NAMES.join(', ')}`);
  process.exit(2);
}
const address = process.env.FAKE_FAN_ADDRESS || '127.0.0.1';
const fan = new FakeFan(fixture, address);
await fan.listen(Number(port), address);
console.log(`Fake ${fan.properties.model} "${fan.properties.name}" on ${address}:${fan.port}`);
