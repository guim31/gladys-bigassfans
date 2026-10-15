// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  hosts: '',
  language: 'fr',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_HOSTS = 32;

/**
 * Parse the manual address list (commas, semicolons, spaces or new lines).
 * IPv4 addresses only, like Home Assistant (which refuses IPv6 fans).
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const host = entry.trim();
    if (!host) {
      continue;
    }
    const normalized = normalizeIpv4(host);
    if (!normalized) {
      invalid.push(host);
    } else if (!hosts.includes(normalized) && hosts.length < MAX_HOSTS) {
      hosts.push(normalized);
    }
  }
  return { hosts, invalid };
}

/** "192.168.001.020" → "192.168.1.20"; null when not an IPv4 address. */
export function normalizeIpv4(value) {
  const match = typeof value === 'string' ? value.trim().match(IPV4) : null;
  if (!match || !match.slice(1).every((part) => Number(part) <= 255)) {
    return null;
  }
  return match.slice(1).map(Number).join('.');
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    hosts,
    invalidHosts: invalid,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
