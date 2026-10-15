// -----------------------------------------------------------------------------
// The i6 wire format: SLIP framing and protobuf messages, checked against the
// byte strings of aiobafi6's own tests (wireutils_test.py, a real Haiku
// answer) and the messages aiobafi6 sends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, escape, frame, unescape } from '../src/baf/slip.js';
import {
  MODE,
  PROPERTIES,
  decodeMessage,
  decodeProperties,
  encodeCommit,
  encodeMessage,
  encodeQuery,
  encodeQueryResult,
  mergeProperties,
} from '../src/baf/proto.js';

// aiobafi6 wireutils_test.py: a query answer of a fan named "Living Room".
const CAPTURE = Buffer.concat([
  Buffer.from([0x12, 0x2b, 0x22, 0x29, 0x12, 0x0d, 0x0a, 0x0b]),
  Buffer.from('Living Room'),
  Buffer.from([0x12, 0x04, 0x18, 0xc0, 0xbe, 0x01]),
  Buffer.from([0x12, 0x03, 0xb0, 0x08, 0x00]),
  Buffer.from([0x12, 0x03, 0xb8, 0x08, 0x00]),
  Buffer.from([0x12, 0x03, 0xc0, 0x08, 0x01]),
  Buffer.from([0x12, 0x03, 0xb0, 0x09, 0x00]),
]);
const ESCAPED_CAPTURE = Buffer.concat([
  CAPTURE.subarray(0, 22),
  Buffer.from([0xdb, 0xdc]),
  CAPTURE.subarray(23, 37),
  Buffer.from([0xdb, 0xdc]),
  CAPTURE.subarray(38),
]);

test('SLIP: escapes and unescapes like aiobafi6', () => {
  assert.deepEqual(escape(Buffer.from([0xc0])), Buffer.from([0xdb, 0xdc]));
  assert.deepEqual(escape(Buffer.from([0xdb])), Buffer.from([0xdb, 0xdd]));
  assert.deepEqual(escape(CAPTURE), ESCAPED_CAPTURE);
  assert.deepEqual(unescape(ESCAPED_CAPTURE), CAPTURE);
  assert.throws(() => unescape(Buffer.from([0xdb, 0x01])), /invalid SLIP escape/);
  assert.throws(() => unescape(Buffer.from([0x01, 0xdb])), /truncated SLIP escape/);
});

test('SLIP: the decoder cuts a stream into messages, whatever the chunks', () => {
  const stream = Buffer.concat([frame(CAPTURE), frame(Buffer.from([1, 2, 0xc0, 3]))]);
  for (const size of [1, 2, 7, stream.length]) {
    const decoder = new FrameDecoder();
    const payloads = [];
    for (let at = 0; at < stream.length; at += size) {
      payloads.push(...decoder.push(stream.subarray(at, at + size)));
    }
    assert.deepEqual(payloads, [CAPTURE, Buffer.from([1, 2, 0xc0, 3])], `chunks of ${size}`);
  }
});

test('SLIP: garbage, empty frames and broken escapes are skipped', () => {
  const decoder = new FrameDecoder();
  const payloads = decoder.push(
    Buffer.from([0x55, 0xc0, 0xc0, 0x01, 0xc0, 0xc0, 0xdb, 0x07, 0xc0, 0xc0, 0x02, 0xc0]),
  );
  assert.deepEqual(payloads, [Buffer.from([1]), Buffer.from([2])]);
  assert.equal(decoder.dropped, 1);
  const small = new FrameDecoder({ maxBytes: 8 });
  assert.throws(() => small.push(Buffer.from([0xc0, 1, 2, 3, 4, 5, 6, 7, 8, 9])), /larger than/);
});

test('decodes the real answer, skipping the fields the proto does not know', () => {
  assert.deepEqual(decodeProperties(CAPTURE), [
    { name: 'Living Room' },
    {},
    { led_indicators_enable: false },
    { fan_beep_enable: false },
    { legacy_ir_remote_enable: true },
    {},
  ]);
});

test('encodes the query and the commits aiobafi6 sends', () => {
  // Root { root2 { query { property_query: ALL } } }
  assert.equal(encodeQuery().toString('hex'), '12041a020800');
  // Root { root2 { commit { properties { fan_mode: ON } } } }
  assert.equal(encodeCommit({ fan_mode: MODE.ON }).toString('hex'), '120712051a03d80201');
  // speed is field 46: tag 0x170 as a varint.
  assert.equal(encodeCommit({ speed: 7 }).toString('hex'), '120712051a03f00207');
  assert.equal(encodeCommit({ whoosh_enable: false }).toString('hex'), '120712051a03d00300');
  assert.deepEqual(frame(encodeQuery()), Buffer.from('c012041a020800c0', 'hex'));
});

test('round trip: nested messages, negatives, strings, booleans', () => {
  const properties = {
    name: 'Été — salon',
    capabilities: { has_comfort1: true, has_comfort3: true, has_light: false },
    fan_mode: MODE.AUTO,
    temperature: -1250,
    humidity: 0,
    reverse_enable: false,
    wifi: { ssid: 'x' },
  };
  const [decoded] = decodeProperties(encodeQueryResult([properties]));
  assert.deepEqual(decoded, properties);
  // A negative int32 takes ten bytes on the wire.
  assert.equal(encodeMessage({ temperature: -1 }, PROPERTIES).length, 12);
});

test('unknown wire types and truncated messages', () => {
  // field 3 fixed64, field 5 fixed32, then name: all skipped but the name.
  const buffer = Buffer.concat([
    Buffer.from([0x19, 1, 2, 3, 4, 5, 6, 7, 8]),
    Buffer.from([0x2d, 1, 2, 3, 4]),
    Buffer.from([0x0a, 0x01, 0x41]),
  ]);
  assert.deepEqual(decodeMessage(buffer, PROPERTIES), { name: 'A' });
  assert.throws(() => decodeMessage(Buffer.from([0x0a, 0x05, 0x41]), PROPERTIES), /truncated/);
  assert.throws(() => decodeMessage(Buffer.from([0x0b]), PROPERTIES), /wire type/);
  assert.throws(() => decodeMessage(Buffer.from([0x80]), PROPERTIES), /varint/);
  // A message that is no query answer carries no property.
  assert.deepEqual(decodeProperties(encodeQuery()), []);
});

test('mergeProperties: scalars replace, nested messages merge', () => {
  const target = { speed: 1, capabilities: { has_light: true } };
  mergeProperties(target, { speed: 0, capabilities: { has_comfort1: true } });
  assert.deepEqual(target, { speed: 0, capabilities: { has_light: true, has_comfort1: true } });
});
