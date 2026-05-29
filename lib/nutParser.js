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

module.exports = { parseNUTResponse, parseStatusFlags };
