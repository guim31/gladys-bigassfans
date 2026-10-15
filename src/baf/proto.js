// -----------------------------------------------------------------------------
// The protobuf messages of the Big Ass Fans i6 protocol, encoded and decoded
// by hand: the few messages below do not justify a protobuf library in a
// 256 MB sandbox.
//
// Field numbers and types come from aiobafi6 (jfroy, Apache 2.0),
// proto/aiobafi6.proto, the only public description of the protocol. Fields
// the firmware sends and the proto does not know are skipped, like
// aiobafi6's DiscardUnknownFields.
//
// Decoded messages are plain objects holding only the fields present on the
// wire (proto2: an explicit `false` or `0` is a value, an absent field is
// not), which is what lets a partial push update only what it carries.
// -----------------------------------------------------------------------------

// Fan and light modes (OffOnAuto in the proto).
export const MODE = { OFF: 0, ON: 1, AUTO: 2 };

// Query.property_query: ALL asks for every property group.
export const QUERY_ALL = 0;

const FIRMWARE = {
  2: ['firmware_version', 'string'],
  3: ['bootloader_version', 'string'],
  4: ['mac_address', 'string'],
};

const CAPABILITIES = {
  1: ['has_comfort1', 'bool'],
  3: ['has_comfort3', 'bool'],
  4: ['has_light', 'bool'],
  6: ['has_uplight', 'bool'],
};

const WIFI = { 1: ['ssid', 'string'] };
const STATS = { 1: ['uptime_minutes', 'int32'] };

export const PROPERTIES = {
  1: ['name', 'string'],
  2: ['model', 'string'],
  4: ['local_datetime', 'string'],
  5: ['utc_datetime', 'string'],
  7: ['firmware_version', 'string'],
  8: ['mac_address', 'string'],
  9: ['uuid9', 'string'],
  10: ['dns_sd_uuid', 'string'],
  11: ['api_endpoint', 'string'],
  13: ['api_version', 'string'],
  16: ['firmware', FIRMWARE],
  17: ['capabilities', CAPABILITIES],
  43: ['fan_mode', 'int32'],
  44: ['reverse_enable', 'bool'],
  45: ['speed_percent', 'int32'],
  46: ['speed', 'int32'],
  47: ['auto_comfort_enable', 'bool'],
  48: ['comfort_ideal_temperature', 'int32'],
  50: ['comfort_min_speed', 'int32'],
  51: ['comfort_max_speed', 'int32'],
  52: ['motion_sense_enable', 'bool'],
  53: ['motion_sense_timeout', 'int32'],
  54: ['return_to_auto_enable', 'bool'],
  55: ['return_to_auto_timeout', 'int32'],
  58: ['whoosh_enable', 'bool'],
  60: ['comfort_heat_assist_enable', 'bool'],
  61: ['comfort_heat_assist_speed', 'int32'],
  62: ['comfort_heat_assist_reverse_enable', 'bool'],
  63: ['target_rpm', 'int32'],
  64: ['current_rpm', 'int32'],
  65: ['eco_enable', 'bool'],
  66: ['fan_occupancy_detected', 'bool'],
  68: ['light_mode', 'int32'],
  69: ['light_brightness_percent', 'int32'],
  70: ['light_brightness_level', 'int32'],
  71: ['light_color_temperature', 'int32'],
  73: ['light_auto_motion_timeout', 'int32'],
  74: ['light_return_to_auto_enable', 'bool'],
  75: ['light_return_to_auto_timeout', 'int32'],
  77: ['light_dim_to_warm_enable', 'bool'],
  78: ['light_warmest_color_temperature', 'int32'],
  79: ['light_coolest_color_temperature', 'int32'],
  85: ['light_occupancy_detected', 'bool'],
  86: ['temperature', 'int32'],
  87: ['humidity', 'int32'],
  120: ['ip_address', 'string'],
  124: ['wifi', WIFI],
  134: ['led_indicators_enable', 'bool'],
  135: ['fan_beep_enable', 'bool'],
  136: ['legacy_ir_remote_enable', 'bool'],
  152: ['remote_firmware', FIRMWARE],
  156: ['stats', STATS],
};

const QUERY = { 1: ['property_query', 'int32'] };
const QUERY_RESULT = { 2: ['properties', PROPERTIES, 'repeated'] };
// Schedules (QueryResult field 3) carry nothing the integration uses.
const COMMIT = { 3: ['properties', PROPERTIES] };
const ROOT2 = { 2: ['commit', COMMIT], 3: ['query', QUERY], 4: ['query_result', QUERY_RESULT] };
const ROOT = { 2: ['root2', ROOT2] };

// --- Wire format ---------------------------------------------------------------

const WIRE = { VARINT: 0, I64: 1, LEN: 2, I32: 5 };

/** Read a varint at `offset`: `{ value: BigInt, offset }`. */
function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < buffer.length && shift < 70n; index += 1) {
    const byte = buffer[index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset: index + 1 };
    }
    shift += 7n;
  }
  throw new Error('truncated or oversized varint');
}

function writeVarint(value) {
  // int32 negatives take ten bytes, as their 64-bit two's complement.
  let rest = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (rest > 0n);
  return Buffer.from(bytes);
}

function convert(type, raw) {
  switch (type) {
    case 'bool':
      return raw !== 0n;
    case 'int32':
      return Number(BigInt.asIntN(32, raw));
    default:
      return undefined;
  }
}

/**
 * Decode one message against a schema (`{ fieldNumber: [name, type, repeated?] }`,
 * type 'string' | 'int32' | 'bool' | a nested schema). Unknown fields are
 * skipped; a field of an unexpected wire type is skipped too.
 */
export function decodeMessage(buffer, schema) {
  const message = {};
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    let raw;
    let bytes;
    switch (wire) {
      case WIRE.VARINT: {
        const read = readVarint(buffer, offset);
        raw = read.value;
        offset = read.offset;
        break;
      }
      case WIRE.I64:
        offset += 8;
        break;
      case WIRE.I32:
        offset += 4;
        break;
      case WIRE.LEN: {
        const length = readVarint(buffer, offset);
        const start = length.offset;
        const end = start + Number(length.value);
        if (end > buffer.length) {
          throw new Error('truncated length-delimited field');
        }
        bytes = buffer.subarray(start, end);
        offset = end;
        break;
      }
      default:
        throw new Error(`unsupported wire type ${wire}`);
    }
    if (offset > buffer.length) {
      throw new Error('truncated fixed-size field');
    }
    const spec = schema[field];
    if (!spec) {
      continue;
    }
    const [name, type, repeated] = spec;
    let value;
    if (typeof type === 'object') {
      value = bytes === undefined ? undefined : decodeMessage(bytes, type);
    } else if (type === 'string') {
      value = bytes === undefined ? undefined : bytes.toString('utf8');
    } else if (raw !== undefined) {
      value = convert(type, raw);
    }
    if (value === undefined) {
      continue;
    }
    if (repeated) {
      (message[name] ??= []).push(value);
    } else if (typeof type === 'object' && message[name]) {
      // protobuf merges a repeated occurrence of a message field.
      message[name] = { ...message[name], ...value };
    } else {
      message[name] = value;
    }
  }
  return message;
}

/** Encode a plain object against a schema; fields in number order. */
export function encodeMessage(message, schema) {
  const parts = [];
  const numbers = Object.keys(schema)
    .map(Number)
    .sort((a, b) => a - b);
  for (const number of numbers) {
    const [name, type, repeated] = schema[number];
    const value = message[name];
    if (value === undefined || value === null) {
      continue;
    }
    for (const item of repeated ? value : [value]) {
      if (typeof type === 'object' || type === 'string') {
        const payload =
          typeof type === 'object' ? encodeMessage(item, type) : Buffer.from(String(item), 'utf8');
        parts.push(writeVarint((number << 3) | WIRE.LEN), writeVarint(payload.length), payload);
      } else {
        const numeric = type === 'bool' ? (item ? 1 : 0) : Math.trunc(Number(item));
        if (!Number.isFinite(numeric)) {
          throw new Error(`${name}: not a number`);
        }
        parts.push(writeVarint((number << 3) | WIRE.VARINT), writeVarint(numeric));
      }
    }
  }
  return Buffer.concat(parts);
}

// --- Messages -----------------------------------------------------------------

/** The message asking a fan for every property (aiobafi6 `_query`). */
export function encodeQuery() {
  return encodeMessage({ root2: { query: { property_query: QUERY_ALL } } }, ROOT);
}

/** The message writing properties (aiobafi6 `_commit_property`). */
export function encodeCommit(properties) {
  return encodeMessage({ root2: { commit: { properties } } }, ROOT);
}

/**
 * The property sets a fan message carries (a query answer or a push), in
 * order; an empty list for any other message.
 */
export function decodeProperties(payload) {
  return decodeMessage(payload, ROOT).root2?.query_result?.properties ?? [];
}

/** Decode any root message (the fake fan reads the queries and commits). */
export function decodeRoot(payload) {
  return decodeMessage(payload, ROOT);
}

/** Encode the answer a fan sends: one root message per property set. */
export function encodeQueryResult(properties) {
  return encodeMessage({ root2: { query_result: { properties } } }, ROOT);
}

/**
 * Merge a partial property set into the known one, like protobuf MergeFrom:
 * a scalar replaces, a nested message merges field by field.
 */
export function mergeProperties(target, partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = { ...(target[key] ?? {}), ...value };
    } else {
      target[key] = value;
    }
  }
  return target;
}
