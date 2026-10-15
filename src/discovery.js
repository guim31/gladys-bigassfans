// -----------------------------------------------------------------------------
// Where to look for Big Ass Fans devices: their mDNS announcements, captured
// by the Gladys core for the integration, and the addresses typed in the
// configuration.
//
// The integration container sits on a bridge network: mDNS never reaches it.
// The core browses the `_api._tcp` service declared in the manifest
// `network_discovery` and relays the raw records; the integration reads the
// TXT entries the fans publish ("api version", "model", "uuid", "name", as
// read by aiobafi6 and Home Assistant), then joins each fan in unicast TCP.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { normalizeIpv4 } from './config.js';
import { MIN_API_VERSION } from './baf/model.js';

export const MDNS_SERVICE = '_api._tcp';
export const SCAN_TIMEOUT_SECONDS = 5;

/**
 * The fan UUID as a stable piece of external id: trimmed, lowercased, and
 * restricted to the characters a UUID uses. null when nothing usable is left.
 */
export function normalizeUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const uuid = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{3,63}$/.test(uuid) ? uuid : null;
}

/**
 * Fans in the raw results of an mDNS scan: `[{ uuid, host, name, model,
 * apiVersion }]`, one per UUID. Other `_api._tcp` services (the name is
 * generic), fans older than the i6 protocol and IPv6-only answers are left
 * out.
 * @param {Array} results `[{ name, host, addresses, port, txt }]`
 */
export function parseMdnsResults(results) {
  const found = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const txt = parseMdnsTxt(result.txt);
    const uuid = normalizeUuid(txt.uuid);
    const apiVersion = Number.parseInt(txt['api version'], 10);
    if (!uuid || typeof txt.model !== 'string' || !(apiVersion >= MIN_API_VERSION)) {
      continue;
    }
    const host = (Array.isArray(result.addresses) ? result.addresses : [])
      .map(normalizeIpv4)
      .find(Boolean);
    if (!host || found.has(uuid)) {
      continue;
    }
    found.set(uuid, {
      uuid,
      host,
      name: typeof txt.name === 'string' ? txt.name : null,
      model: txt.model,
      apiVersion,
    });
  }
  return [...found.values()];
}
