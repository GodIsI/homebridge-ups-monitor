'use strict';

/**
 * lib/nutClient.js
 *
 * NUT (Network UPS Tools) TCP client.
 * Opens a single connection to upsd, sends all GET VAR commands in one shot,
 * collects the response, and resolves with a parsed data object.
 *
 * Extracted from index.js / homebridge-ui/server.js to avoid duplication and
 * to allow independent testing with a mock TCP server.
 */

const net = require('net');
const { parseNUTResponse, parseNUTErrors, parseInstCmds, parseRWVars, parseCommandResult } = require('./nutParser');

/**
 * Thrown by queryNUT() when upsd returns a NUT-protocol error that makes the
 * reading unusable (as opposed to a benign "optional variable not supported"
 * response, which stays silently omitted from the resolved data — see
 * NUT_ERROR_CATALOG's 'unsupported' category in lib/nutParser.js).
 *
 * Carries enough structure for callers to log, categorise, and show
 * actionable guidance without re-parsing the message string:
 *   code       — the raw NUT error token, e.g. 'DATA-STALE'
 *   category   — 'stale-data' | 'unknown-ups' | 'auth' | 'server'
 *   retryable  — true if polling again (no config change) may succeed
 *   guidance   — human-readable next step, or null if none is available
 *   upsName    — which configured UPS the query was for
 */
class NUTQueryError extends Error {
  constructor(message, { code, category, retryable, guidance, upsName } = {}) {
    super(message);
    this.name = 'NUTQueryError';
    this.code = code || null;
    this.category = category || 'server';
    this.retryable = retryable === true;
    this.guidance = guidance || null;
    this.upsName = upsName || null;
  }
}

// Errors are surfaced in this priority order when a query returns more than
// one distinct category (auth/config problems are usually more actionable to
// see first, since a stale-data reading is often just a symptom of one).
const CATEGORY_PRIORITY = { auth: 0, 'unknown-ups': 1, 'stale-data': 2, server: 3 };

/** Default NUT variables fetched on every poll */
const NUT_VARS = [
  'ups.status',
  'input.voltage',
  'input.voltage.nominal',
  'output.voltage',
  'output.voltage.nominal',
  'battery.charge',
  'battery.charge.low',
  'battery.voltage',
  'battery.voltage.nominal',
  'ups.load',
  'battery.runtime',   // seconds
  'ups.realpower',
  'ups.power',
  'ups.model',
  'ups.mfr',
  'ups.beeper.status',
];

/**
 * Query a NUT server and return a parsed data object.
 *
 * @param {string}      host        upsd hostname or IP
 * @param {number}      port        upsd port (default 3493)
 * @param {string}      upsName     UPS name as shown by `upsc -l` (e.g. 'ups')
 * @param {string|null} username    NUT username (null if auth not required)
 * @param {string|null} password    NUT password (null if auth not required)
 * @param {string[]}    [vars]      Override the default NUT_VARS list
 * @param {number}      [timeoutMs] TCP timeout in ms (default 8000)
 * @returns {Promise<Object>}       Parsed key→value map of UPS variables
 */
async function queryNUT(host, port, upsName, username, password, vars, timeoutMs = 8000) {
  // Auth lines (when credentials are provided) followed by one GET VAR per
  // requested variable. _exchange appends LOGOUT and handles the socket.
  const lines = [
    ..._authLines(username, password),
    ...(vars || NUT_VARS).map(v => `GET VAR ${upsName} ${v}`),
  ];
  const buffer = await _exchange(host, port, lines, timeoutMs);
  const data   = parseNUTResponse(buffer);

  // Errors classified 'unsupported' (VAR-NOT-SUPPORTED and friends) are
  // expected for optional variables and stay silent — the caller already
  // gets the reduced data object with those keys simply absent. Anything
  // else (stale data, unknown UPS, auth problems, ...) means the reading
  // as a whole can't be trusted, so reject with a structured error instead
  // of silently resolving with an empty/partial object.
  const surfaced = parseNUTErrors(buffer, { upsName })
    .filter(e => e.category !== 'unsupported');

  if (surfaced.length) {
    surfaced.sort((a, b) => (CATEGORY_PRIORITY[a.category] ?? 9) - (CATEGORY_PRIORITY[b.category] ?? 9));
    const top = surfaced[0];
    throw new NUTQueryError(top.message, { ...top, upsName });
  }

  return data;
}


// ─── Control-command support (INSTCMD / SET) ────────────────────────────────────

/** Build optional USERNAME/PASSWORD auth lines. */
function _authLines(username, password) {
  const a = [];
  if (username) a.push(`USERNAME ${username}`);
  if (password) a.push(`PASSWORD ${password}`);
  return a;
}

/**
 * Open a connection, send the given command lines (LOGOUT is appended), collect
 * the full reply, and resolve with the raw buffer.
 * @returns {Promise<string>}
 */
function _exchange(host, port, lines, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: port || 3493, host: host || '127.0.0.1' });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    socket.on('connect', () => socket.write(lines.concat('LOGOUT').join('\n') + '\n'));
    socket.on('data',    chunk => { buffer += chunk.toString(); });
    const done = () => resolve(buffer);
    socket.on('end',   done);
    socket.on('close', done);
    socket.on('error', err => reject(err));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('NUT connection timed out')); });
  });
}

/** List the instant commands a UPS advertises (`LIST CMD <ups>`). */
async function listInstCmds(host, port, upsName, username, password, timeoutMs) {
  const buf = await _exchange(host, port, [..._authLines(username, password), `LIST CMD ${upsName}`], timeoutMs);
  return parseInstCmds(buf);
}

/** List the read-write variables a UPS advertises (`LIST RW <ups>`). */
async function listRWVars(host, port, upsName, username, password, timeoutMs) {
  const buf = await _exchange(host, port, [..._authLines(username, password), `LIST RW ${upsName}`], timeoutMs);
  return parseRWVars(buf);
}

/** Send an instant command (`INSTCMD <ups> <cmd>`). Resolves { ok, message }. */
async function sendInstCmd(host, port, upsName, username, password, cmd, timeoutMs) {
  const buf = await _exchange(host, port, [..._authLines(username, password), `INSTCMD ${upsName} ${cmd}`], timeoutMs);
  return parseCommandResult(buf);
}

/** Set a writable variable (`SET VAR <ups> <var> "<value>"`). Resolves { ok, message }. */
async function setVar(host, port, upsName, username, password, varName, value, timeoutMs) {
  const buf = await _exchange(
    host, port,
    [..._authLines(username, password), `SET VAR ${upsName} ${varName} "${value}"`],
    timeoutMs,
  );
  return parseCommandResult(buf);
}

module.exports = { queryNUT, NUT_VARS, listInstCmds, listRWVars, sendInstCmd, setVar, NUTQueryError };
