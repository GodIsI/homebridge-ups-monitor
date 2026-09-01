'use strict';

/**
 * lib/nutParser.js
 *
 * Pure utility functions for parsing NUT (Network UPS Tools) protocol responses.
 * Kept side-effect-free so they can be unit-tested without any network or
 * Homebridge dependency.
 */

/**
 * Parse a raw NUT response buffer into a plain key→value object.
 *
 * Handles response lines of the form:
 *   VAR <upsName> <variable> "<value>"
 *
 * Numeric strings are coerced to numbers; everything else stays as a string.
 * Non-VAR lines (OK, ERR, OK Goodbye, etc.) are silently ignored.
 *
 * @param {string} buffer  Raw text accumulated from the upsd TCP socket
 * @returns {Object}       e.g. { 'input.voltage': 230.5, 'ups.status': 'OL' }
 */
function parseNUTResponse(buffer) {
  const result = {};
  for (const line of String(buffer || '').split('\n')) {
    // NUT wire format: VAR <ups> <variable> "<value>"
    const m = line.match(/^VAR \S+ (\S+) "(.*)"/);
    if (m) {
      const raw = m[2];
      result[m[1]] = (raw !== '' && !isNaN(raw)) ? parseFloat(raw) : raw;
    }
  }
  return result;
}

/**
 * Catalog of NUT protocol error codes (the token after `ERR ` in an upsd
 * reply — see https://networkupstools.org/docs/developer-guide.chunked/apas01.html).
 *
 * Each entry classifies the code so callers can decide what to do with it:
 *   - category:  groups related failures for prioritisation/UI treatment.
 *       'unsupported' — the server is telling us an optional thing isn't
 *                        available (a variable, command or feature). Expected
 *                        and silent — never a reason to fail a query.
 *       'stale-data'  — the driver isn't producing fresh readings (USB/serial
 *                        link or the driver process itself).
 *       'unknown-ups' — the requested UPS name doesn't exist on this server.
 *       'auth'        — missing/invalid credentials or insufficient access.
 *       'server'      — anything else (session state, malformed request, …).
 *   - retryable: whether polling again without changing configuration has a
 *                reasonable chance of succeeding (a transient driver hiccup)
 *                as opposed to needing a config/credential fix first.
 *   - guidance:  (code, ctx) => human-readable next step, shown to the user
 *                alongside the raw protocol error. `ctx.upsName` is the UPS
 *                the query was for.
 *
 * Unrecognised codes fall back to `UNKNOWN_NUT_ERROR` below.
 */
const NUT_ERROR_CATALOG = {
  'VAR-NOT-SUPPORTED': {
    category: 'unsupported', retryable: false,
    guidance: () => null,
  },
  'CMD-NOT-SUPPORTED': {
    category: 'unsupported', retryable: false,
    guidance: () => null,
  },
  'FEATURE-NOT-SUPPORTED': {
    category: 'unsupported', retryable: false,
    guidance: () => null,
  },
  'FEATURE-NOT-CONFIGURED': {
    category: 'unsupported', retryable: false,
    guidance: () => null,
  },
  'DATA-STALE': {
    category: 'stale-data', retryable: true,
    guidance: (ctx) =>
      `The NUT driver for "${ctx.upsName}" is not producing fresh data. Check the driver status ` +
      `(e.g. run "upsc ${ctx.upsName}" on the NUT server, or inspect the driver logs) and the ` +
      'USB/serial connection between the server and the UPS.',
  },
  'DRIVER-NOT-CONNECTED': {
    category: 'stale-data', retryable: true,
    guidance: (ctx) =>
      `The NUT driver for "${ctx.upsName}" is not connected to upsd. Restart the driver ` +
      `(e.g. "upsdrvctl start") and check dmesg/driver logs for USB or serial errors.`,
  },
  'UNKNOWN-UPS': {
    category: 'unknown-ups', retryable: false,
    guidance: (ctx) =>
      `NUT UPS names are case-sensitive. Confirm "${ctx.upsName}" matches an entry from ` +
      '"upsc -l" on the NUT server, and update the plugin config if it does not.',
  },
  'ACCESS-DENIED': {
    category: 'auth', retryable: false,
    guidance: (ctx) =>
      'Verify the configured NUT username/password and that this user is granted access to ' +
      `"${ctx.upsName}" in upsd.users on the NUT server.`,
  },
  'USERNAME-REQUIRED': {
    category: 'auth', retryable: false,
    guidance: () => 'This NUT server requires a username. Set "username" (and "password") in the plugin config.',
  },
  'PASSWORD-REQUIRED': {
    category: 'auth', retryable: false,
    guidance: () => 'This NUT server requires a password. Set "password" in the plugin config.',
  },
  'INVALID-USERNAME': {
    category: 'auth', retryable: false,
    guidance: () => 'The configured NUT "username" was rejected. Check it against upsd.users on the NUT server.',
  },
  'INVALID-PASSWORD': {
    category: 'auth', retryable: false,
    guidance: () => 'The configured NUT "password" was rejected. Check it against upsd.users on the NUT server.',
  },
};

/** Fallback classification for an ERR code with no catalog entry. */
const UNKNOWN_NUT_ERROR = { category: 'server', retryable: false, guidance: () => null };

/**
 * Parse the `ERR <code>[ <extra>]` lines out of a raw NUT response buffer into
 * structured error objects, classified via NUT_ERROR_CATALOG.
 *
 * Kept separate from parseNUTResponse() (which still silently ignores ERR
 * lines) so existing callers of parseNUTResponse are unaffected; callers that
 * care about failures call both.
 *
 * @param {string} buffer
 * @param {{ upsName?: string }} [ctx]  Context used to fill in guidance text.
 * @returns {Array<{ code: string, message: string, category: string, retryable: boolean, guidance: string|null }>}
 */
function parseNUTErrors(buffer, ctx = {}) {
  const errors = [];
  for (const line of String(buffer || '').split('\n')) {
    const m = line.match(/^ERR\s+(\S+)(?:\s+(.*))?$/);
    if (!m) continue;
    const code = m[1];
    const extra = m[2] ? m[2].trim() : '';
    const entry = NUT_ERROR_CATALOG[code] || UNKNOWN_NUT_ERROR;
    errors.push({
      code,
      message:   extra ? `${code}: ${extra}` : code,
      category:  entry.category,
      retryable: entry.retryable,
      guidance:  entry.guidance(ctx) || null,
    });
  }
  return errors;
}

/**
 * Parse a NUT ups.status string into discrete boolean flags.
 *
 * Common NUT status tokens:
 *   OL      — On line (mains power present)
 *   OB      — On battery
 *   LB      — Low battery
 *   CHRG    — Battery charging
 *   DISCHRG — Battery discharging
 *   BYPASS  — On bypass
 *   CAL     — Performing calibration
 *   OFF     — UPS is off
 *   OVER    — Overloaded
 *   TRIM    — Trimming incoming voltage
 *   BOOST   — Boosting incoming voltage
 *   FSD     — Forced shutdown
 *
 * @param {string} statusStr  e.g. "OL CHRG" or "OB LB"
 * @returns {{ onLine, onBattery, lowBattery, charging, discharging, raw }}
 */
function parseStatusFlags(statusStr) {
  const s = String(statusStr || '').toUpperCase();
  const has = token => s.split(/\s+/).includes(token);
  return {
    onLine:      has('OL'),
    onBattery:   has('OB'),
    lowBattery:  has('LB'),
    charging:    has('CHRG') && !has('DISCHRG'),
    discharging: has('DISCHRG'),
    raw:         s.trim(),
  };
}


/**
 * Parse a `LIST CMD <ups>` response into an array of instant-command names.
 * Lines look like:  CMD <ups> beeper.disable
 *
 * @param {string} buffer
 * @returns {string[]}  e.g. ['beeper.enable', 'beeper.disable', 'load.off']
 */
function parseInstCmds(buffer) {
  const cmds = [];
  for (const line of String(buffer || '').split('\n')) {
    const m = line.match(/^CMD \S+ (\S+)/);
    if (m) cmds.push(m[1]);
  }
  return cmds;
}

/**
 * Parse a `LIST RW <ups>` response into an array of writable variable names.
 * Lines look like:  RW <ups> battery.charge.low "20"
 *
 * @param {string} buffer
 * @returns {string[]}  e.g. ['battery.charge.low', 'ups.delay.shutdown']
 */
function parseRWVars(buffer) {
  const vars = [];
  for (const line of String(buffer || '').split('\n')) {
    const m = line.match(/^RW \S+ (\S+)/);
    if (m) vars.push(m[1]);
  }
  return vars;
}

/**
 * Interpret an upsd reply to a control command (INSTCMD / SET VAR).
 * upsd answers `OK` on success or `ERR <reason>` on failure (per line).
 * Auth lines (USERNAME/PASSWORD) also return `OK`, so we treat the presence of
 * ANY `ERR` line as failure and otherwise require at least one `OK`.
 *
 * @param {string} buffer
 * @returns {{ ok: boolean, message: string }}
 */
function parseCommandResult(buffer) {
  const lines = String(buffer || '').split('\n').map(l => l.trim()).filter(Boolean);
  const err = lines.find(l => l.startsWith('ERR'));
  if (err) return { ok: false, message: err.replace(/^ERR\s*/, '') || 'ERR' };
  const ok = lines.some(l => l === 'OK' || l.startsWith('OK '));
  return { ok, message: ok ? 'OK' : 'no response' };
}

module.exports = {
  parseNUTResponse,
  parseStatusFlags,
  parseInstCmds,
  parseRWVars,
  parseCommandResult,
  parseNUTErrors,
  NUT_ERROR_CATALOG,
};
