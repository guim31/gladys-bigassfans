// -----------------------------------------------------------------------------
// What a Big Ass Fans device can do, read from its properties.
//
// The rules follow aiobafi6 and the Home Assistant `baf` integration (both
// Apache 2.0): no model table, only the capability flags and the properties
// the firmware reports. A light is announced by `has_light` or, on Haiku H/I
// fans with an uplight only, by `has_uplight`; the temperature sensor and the
// occupancy sensor come with Auto Comfort (`has_comfort1` and `has_comfort3`),
// occupancy from API version 5 on; the humidity sensor when the fan reports a
// humidity between 1 and 100 %.
// -----------------------------------------------------------------------------

// aiobafi6 _PROPS_REQUIRED_FOR_AVAILABLE: a fan that sent these is identified.
export const REQUIRED_PROPERTIES = [
  'name',
  'model',
  'firmware_version',
  'mac_address',
  'dns_sd_uuid',
  'capabilities',
  'ip_address',
];

// The i6 protocol starts at API version 4 (aiobafi6 MIN_API_VERSION), the
// occupancy sensor at 5.
export const MIN_API_VERSION = 4;
export const OCCUPANCY_MIN_API_VERSION = 5;

// The seven speeds of every BAF fan (aiobafi6 _MAX_SPEED).
export const SPEED_MAX = 7;
// The light levels the firmware steps in (light_brightness_level, 0-16).
export const LIGHT_LEVELS = 16;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** True once the fan sent every property that identifies it. */
export function isIdentified(properties) {
  return REQUIRED_PROPERTIES.every((key) => properties[key] !== undefined);
}

export function apiVersion(properties) {
  const version = Number.parseInt(properties.api_version, 10);
  return Number.isFinite(version) ? version : 0;
}

/** Auto Comfort: both comfort flags (home-assistant/core#72934). */
export function hasAutoComfort(properties) {
  const caps = properties.capabilities ?? {};
  return caps.has_comfort1 === true && caps.has_comfort3 === true;
}

/**
 * The capabilities of a device, from its properties: which features it gets.
 * @param {object} properties merged properties of the device
 */
export function capabilitiesOf(properties) {
  const caps = properties.capabilities ?? {};
  // A light-only device (Haiku L lights, aiobafi6 TODO #1) reports no fan
  // property.
  const fan = properties.fan_mode !== undefined || properties.speed !== undefined;
  const light = caps.has_light === true || caps.has_uplight === true;
  const warmest = properties.light_warmest_color_temperature;
  const coolest = properties.light_coolest_color_temperature;
  const comfort = hasAutoComfort(properties);
  return {
    fan,
    reverse: fan && properties.reverse_enable !== undefined,
    whoosh: fan && properties.whoosh_enable !== undefined,
    light,
    colorTemperature:
      light && isNumber(warmest) && isNumber(coolest) && warmest > 0 && warmest < coolest
        ? { min: warmest, max: coolest }
        : null,
    temperature: comfort && isNumber(properties.temperature),
    humidity:
      isNumber(properties.humidity) && properties.humidity > 0 && properties.humidity <= 100,
    occupancy: comfort && apiVersion(properties) >= OCCUPANCY_MIN_API_VERSION,
  };
}

/**
 * Capabilities only grow: a property missing from one answer never removes a
 * feature the user may have added (its external id would be orphaned).
 */
export function mergeCapabilities(previous, next) {
  if (!previous) {
    return next;
  }
  const merged = {};
  for (const key of Object.keys(next)) {
    merged[key] =
      key === 'colorTemperature'
        ? (next[key] ?? previous[key] ?? null)
        : Boolean(previous[key] || next[key]);
  }
  return merged;
}

/** Capabilities read back from /data, or null when unusable. */
export function restoreCapabilities(saved) {
  if (!saved || typeof saved !== 'object') {
    return null;
  }
  const range = saved.colorTemperature;
  return {
    fan: saved.fan === true,
    reverse: saved.reverse === true,
    whoosh: saved.whoosh === true,
    light: saved.light === true,
    colorTemperature:
      range && isNumber(range.min) && isNumber(range.max) && range.min < range.max
        ? { min: range.min, max: range.max }
        : null,
    temperature: saved.temperature === true,
    humidity: saved.humidity === true,
    occupancy: saved.occupancy === true,
  };
}

/** Light brightness in %, from the percent or, failing that, the level. */
export function brightnessPercent(properties) {
  if (isNumber(properties.light_brightness_percent)) {
    return clamp(Math.round(properties.light_brightness_percent), 0, 100);
  }
  if (isNumber(properties.light_brightness_level)) {
    return clamp(Math.round((properties.light_brightness_level / LIGHT_LEVELS) * 100), 0, 100);
  }
  return undefined;
}

/**
 * The light level a brightness asks for: never 0, which the firmware takes as
 * "off" (Home Assistant: max(int(brightness / 255 * 16), 1)).
 */
export function brightnessLevel(percent) {
  return clamp(Math.round((percent / 100) * LIGHT_LEVELS), 1, LIGHT_LEVELS);
}
