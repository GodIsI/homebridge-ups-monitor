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
const { parseNUTResponse } = require('./nutParser');

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
function queryNUT(host, port, upsName, username, password, vars, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      port: port || 3493,
      host: host || '127.0.0.1',
    });
    socket.setTimeout(timeoutMs);

    let buffer = '';

    // Build the command sequence; auth lines only when credentials are provided
    const cmds = [];
    if (username) cmds.push(`USERNAME ${username}`);
    if (password) cmds.push(`PASSWORD ${password}`);
    (vars || NUT_VARS).forEach(v => cmds.push(`GET VAR ${upsName} ${v}`));
    cmds.push('LOGOUT');

    socket.on('connect', () => socket.write(cmds.join('\n') + '\n'));
    socket.on('data',    chunk => { buffer += chunk.toString(); });

    const done = () => resolve(parseNUTResponse(buffer));
    socket.on('end',   done);
    socket.on('close', done);
    socket.on('error', err => reject(err));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('NUT connection timed out'));
    });
  });
}

module.exports = { queryNUT, NUT_VARS };
