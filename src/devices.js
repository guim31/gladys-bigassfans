// -----------------------------------------------------------------------------
// From a Big Ass Fans device to a Gladys device, and back: discovery payload,
// state values, and the properties each Gladys command writes.
//
// One Gladys device per fan (or light), keyed on the UUID the fan announces
// in mDNS and reports as `dns_sd_uuid` (Home Assistant keys its entries on the
// same id). Only what the device has is published.
//
// The commands write the properties Home Assistant writes (fan_mode, speed,
// reverse_enable, whoosh_enable, light_mode, light_brightness_level,
// light_color_temperature): the ones proven on real fans.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { MODE } from './baf/proto.js';
import { LIGHT_LEVELS, SPEED_MAX, brightnessLevel, brightnessPercent, clamp } from './baf/model.js';

export const DEVICE_TYPE = 'fan';

export const FEATURE_KEYS = {
  FAN: 'fan',
  FAN_AUTO: 'fan-auto',
  SPEED: 'speed',
  DIRECTION: 'direction',
  WHOOSH: 'whoosh',
  LIGHT: 'light',
  LIGHT_AUTO: 'light-auto',
  BRIGHTNESS: 'brightness',
  COLOR_TEMPERATURE: 'color-temperature',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  OCCUPANCY: 'occupancy',
};

// Feature names are frozen when the user creates the device: written in the
// language chosen in the configuration at that moment.
export const NAMES = {
  en: {
    fan: 'Fan',
    'fan-auto': 'Fan auto mode',
    speed: 'Speed',
    direction: 'Direction',
    whoosh: 'Whoosh (natural breeze)',
    light: 'Light',
    'light-auto': 'Light auto mode',
    brightness: 'Brightness',
    'color-temperature': 'Color temperature',
    temperature: 'Temperature',
    humidity: 'Humidity',
    occupancy: 'Occupancy',
  },
  fr: {
    fan: 'Ventilateur',
    'fan-auto': 'Mode auto du ventilateur',
    speed: 'Vitesse',
    direction: 'Sens de rotation',
    whoosh: 'Whoosh (brise naturelle)',
    light: 'Éclairage',
    'light-auto': "Mode auto de l'éclairage",
    brightness: 'Luminosité',
    'color-temperature': 'Température de couleur',
    temperature: 'Température',
    humidity: 'Humidité',
    occupancy: 'Présence',
  },
  de: {
    fan: 'Ventilator',
    'fan-auto': 'Ventilator-Automatik',
    speed: 'Geschwindigkeit',
    direction: 'Drehrichtung',
    whoosh: 'Whoosh (natürliche Brise)',
    light: 'Licht',
    'light-auto': 'Licht-Automatik',
    brightness: 'Helligkeit',
    'color-temperature': 'Farbtemperatur',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    occupancy: 'Anwesenheit',
  },
  es: {
    fan: 'Ventilador',
    'fan-auto': 'Modo automático del ventilador',
    speed: 'Velocidad',
    direction: 'Sentido de giro',
    whoosh: 'Whoosh (brisa natural)',
    light: 'Luz',
    'light-auto': 'Modo automático de la luz',
    brightness: 'Brillo',
    'color-temperature': 'Temperatura de color',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    occupancy: 'Presencia',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/** External ids of the Gladys device of a fan. */
export const deviceIds = (gladys, uuid) => gladys.externalIds(DEVICE_TYPE, uuid);

/** The name the fan was given in the Big Ass Fans app, else its model. */
export function deviceName(record) {
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name) {
    return name;
  }
  return `Big Ass Fans ${record.model || record.uuid.slice(-6)}`;
}

// The firmware reports the temperature in hundredths of a degree; a fan in a
// garage or on a terrace can read below zero, and the gauge wants symmetric
// bounds for a signed value.
const TEMPERATURE_BOUND = 60;

/**
 * Feature specs of a device, in publication order.
 * @param {object} caps capabilitiesOf() of the device
 * @param {string} language
 */
export function featureSpecs(caps, language) {
  const names = namesFor(language);
  const specs = [];
  const binary = (key, category, type, history = true) => ({
    key,
    name: names[key],
    category,
    type,
    min: 0,
    max: 1,
    history,
  });
  if (caps.fan) {
    specs.push(binary(FEATURE_KEYS.FAN, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
    specs.push(binary(FEATURE_KEYS.FAN_AUTO, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
    // A level slider: the seven speeds of the fan, 0 when it is off.
    specs.push({
      key: FEATURE_KEYS.SPEED,
      name: names.speed,
      category: CATEGORIES.FAN,
      type: TYPES.FAN.SPEED,
      min: 0,
      max: SPEED_MAX,
      history: true,
    });
    if (caps.reverse) {
      // Gladys' own list: 0 forward (summer), 1 reverse (winter).
      specs.push(binary(FEATURE_KEYS.DIRECTION, CATEGORIES.FAN, TYPES.FAN.AIRFLOW_DIRECTION));
    }
    if (caps.whoosh) {
      specs.push(binary(FEATURE_KEYS.WHOOSH, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
    }
  }
  if (caps.light) {
    specs.push(binary(FEATURE_KEYS.LIGHT, CATEGORIES.LIGHT, TYPES.LIGHT.BINARY));
    specs.push(binary(FEATURE_KEYS.LIGHT_AUTO, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
    specs.push({
      key: FEATURE_KEYS.BRIGHTNESS,
      name: names.brightness,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BRIGHTNESS,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      history: true,
    });
    if (caps.colorTemperature) {
      // In kelvins, between the warmest and the coolest white of the light.
      specs.push({
        key: FEATURE_KEYS.COLOR_TEMPERATURE,
        name: names['color-temperature'],
        category: CATEGORIES.LIGHT,
        type: TYPES.LIGHT.TEMPERATURE,
        unit: UNITS.KELVIN,
        min: caps.colorTemperature.min,
        max: caps.colorTemperature.max,
        history: true,
      });
    }
  }
  if (caps.temperature) {
    specs.push({
      key: FEATURE_KEYS.TEMPERATURE,
      name: names.temperature,
      category: CATEGORIES.TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      min: -TEMPERATURE_BOUND,
      max: TEMPERATURE_BOUND,
      read_only: true,
      history: true,
    });
  }
  if (caps.humidity) {
    specs.push({
      key: FEATURE_KEYS.HUMIDITY,
      name: names.humidity,
      category: CATEGORIES.HUMIDITY_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      history: true,
    });
  }
  if (caps.occupancy) {
    specs.push({
      ...binary(FEATURE_KEYS.OCCUPANCY, CATEGORIES.PRESENCE_SENSOR, TYPES.SENSOR.BINARY),
      read_only: true,
    });
  }
  return specs;
}

/** Discovery payload of one fan. */
export function buildDevice(gladys, record, language) {
  const ids = deviceIds(gladys, record.uuid);
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: record.model || 'Big Ass Fans',
    // The fan pushes its changes on the connection the container keeps open,
    // and the container queries it every minute: Gladys never polls it.
    should_poll: false,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      ...(record.firmware ? [{ name: 'FIRMWARE', value: record.firmware }] : []),
    ],
    features: featureSpecs(record.caps, language).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: true,
        keep_history: spec.history,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      return feature;
    }),
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const flag = (value) => (value ? 1 : 0);

/**
 * Feature values of a device, by feature key: only what its properties tell.
 * @param {object} record { caps, properties }
 */
export function deviceValues(record) {
  const { caps } = record;
  const props = record.properties ?? {};
  const values = {};
  if (caps.fan && isNumber(props.fan_mode)) {
    values[FEATURE_KEYS.FAN] = flag(props.fan_mode === MODE.ON);
    values[FEATURE_KEYS.FAN_AUTO] = flag(props.fan_mode === MODE.AUTO);
    if (props.fan_mode === MODE.OFF) {
      values[FEATURE_KEYS.SPEED] = 0;
    } else if (isNumber(props.speed)) {
      values[FEATURE_KEYS.SPEED] = clamp(Math.round(props.speed), 0, SPEED_MAX);
    }
  } else if (caps.fan && isNumber(props.speed)) {
    values[FEATURE_KEYS.SPEED] = clamp(Math.round(props.speed), 0, SPEED_MAX);
  }
  if (caps.reverse && typeof props.reverse_enable === 'boolean') {
    values[FEATURE_KEYS.DIRECTION] = flag(props.reverse_enable);
  }
  if (caps.whoosh && typeof props.whoosh_enable === 'boolean') {
    values[FEATURE_KEYS.WHOOSH] = flag(props.whoosh_enable);
  }
  if (caps.light) {
    if (isNumber(props.light_mode)) {
      values[FEATURE_KEYS.LIGHT] = flag(props.light_mode === MODE.ON);
      values[FEATURE_KEYS.LIGHT_AUTO] = flag(props.light_mode === MODE.AUTO);
    }
    const brightness = brightnessPercent(props);
    if (brightness !== undefined) {
      values[FEATURE_KEYS.BRIGHTNESS] = brightness;
    }
    const kelvin = props.light_color_temperature;
    if (caps.colorTemperature && isNumber(kelvin) && kelvin > 0) {
      values[FEATURE_KEYS.COLOR_TEMPERATURE] = clamp(
        Math.round(kelvin),
        caps.colorTemperature.min,
        caps.colorTemperature.max,
      );
    }
  }
  if (caps.temperature && isNumber(props.temperature)) {
    values[FEATURE_KEYS.TEMPERATURE] = Math.round(props.temperature / 10) / 10;
  }
  if (caps.humidity && isNumber(props.humidity) && props.humidity >= 0 && props.humidity <= 100) {
    values[FEATURE_KEYS.HUMIDITY] = props.humidity;
  }
  if (caps.occupancy && typeof props.fan_occupancy_detected === 'boolean') {
    values[FEATURE_KEYS.OCCUPANCY] = flag(props.fan_occupancy_detected);
  }
  return values;
}

export class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * The property writes of a Gladys command, in order: the firmware is not
 * known to take several properties in one commit (aiobafi6), so each write
 * is its own commit. An empty list when there is nothing to change.
 * Like the other Gladys lights and fans, a speed, a brightness or a white
 * also turns the fan or the light on.
 * @param {object} record { caps, properties }
 * @param {string} key feature key
 * @param {number} value
 * @returns {object[]}
 */
export function commandFor(record, key, value) {
  const { caps } = record;
  const props = record.properties ?? {};
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new CommandError('invalid', `Invalid value "${value}" for ${key}`);
  }
  const on = number > 0;
  const fanOn = props.fan_mode === MODE.ON ? [] : [{ fan_mode: MODE.ON }];
  const lightOn = props.light_mode === MODE.ON ? [] : [{ light_mode: MODE.ON }];
  switch (key) {
    case FEATURE_KEYS.FAN:
      if (caps.fan) {
        return [{ fan_mode: on ? MODE.ON : MODE.OFF }];
      }
      break;
    case FEATURE_KEYS.FAN_AUTO:
      if (caps.fan) {
        // Leaving the auto mode stops the fan: on and auto are the two other
        // positions of the same three-way mode (off, on, auto).
        if (on) {
          return [{ fan_mode: MODE.AUTO }];
        }
        return props.fan_mode === MODE.AUTO ? [{ fan_mode: MODE.OFF }] : [];
      }
      break;
    case FEATURE_KEYS.SPEED:
      if (caps.fan) {
        if (!on) {
          return [{ fan_mode: MODE.OFF }];
        }
        return [...fanOn, { speed: clamp(Math.round(number), 1, SPEED_MAX) }];
      }
      break;
    case FEATURE_KEYS.DIRECTION:
      if (caps.reverse) {
        return [{ reverse_enable: number >= 1 }];
      }
      break;
    case FEATURE_KEYS.WHOOSH:
      if (caps.whoosh) {
        return [{ whoosh_enable: on }];
      }
      break;
    case FEATURE_KEYS.LIGHT:
      if (caps.light) {
        return [{ light_mode: on ? MODE.ON : MODE.OFF }];
      }
      break;
    case FEATURE_KEYS.LIGHT_AUTO:
      if (caps.light) {
        if (on) {
          return [{ light_mode: MODE.AUTO }];
        }
        return props.light_mode === MODE.AUTO ? [{ light_mode: MODE.OFF }] : [];
      }
      break;
    case FEATURE_KEYS.BRIGHTNESS:
      if (caps.light) {
        if (!on) {
          return [{ light_mode: MODE.OFF }];
        }
        return [...lightOn, { light_brightness_level: brightnessLevel(number) }];
      }
      break;
    case FEATURE_KEYS.COLOR_TEMPERATURE:
      if (caps.colorTemperature) {
        const { min, max } = caps.colorTemperature;
        return [{ light_color_temperature: clamp(Math.round(number), min, max) }, ...lightOn];
      }
      break;
    default:
      break;
  }
  throw new CommandError('unsupported', `Feature "${key}" cannot be set on this device`);
}

/**
 * What the device shows once a write is applied, without waiting for its
 * push: the brightness percent follows the level written.
 */
export function applyWrite(properties, write) {
  const next = { ...properties, ...write };
  if (write.light_brightness_level !== undefined) {
    next.light_brightness_percent = Math.round((write.light_brightness_level / LIGHT_LEVELS) * 100);
  }
  return next;
}
