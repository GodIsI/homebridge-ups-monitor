'use strict';

/**
 * homebridge-ui/server.js
 *
 * Runs server-side inside the Homebridge UI process.
 * Handles HTTP requests from the dashboard UI (index.html) via homebridge.request().
 *
 * Endpoint:
 *   POST /ups-status   → queries NUT and returns JSON for all configured UPS units
 */

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const net = require('net');

// NUT variables fetched for the dashboard — slightly expanded vs the HomeKit poll
const NUT_VARS = [
  'ups.status',
  'ups.model',
  'ups.mfr',
  'input.voltage',
  'input.voltage.nominal',
  'output.voltage',
  'output.voltage.nominal',
  'battery.charge',
  'battery.charge.low',
  'battery.voltage',
  'battery.voltage.nominal',
  'ups.load',
  'battery.runtime',   // seconds — we'll convert to minutes in the UI
  'ups.realpower',
  'ups.power',
];

// ─── NUT query helper (same logic as index.js) ────────────────────────────────
function queryNUT(host, port, upsName, username, password) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: port || 3493, host: host || '127.0.0.1' });
    socket.setTimeout(8000);
    let buffer = '';

    const cmds = [];
    if (username) cmds.push(`USERNAME ${username}`);
    if (password) cmds.push(`PASSWORD ${password}`);
    NUT_VARS.forEach(v => cmds.push(`GET VAR ${upsName} ${v}`));
    cmds.push('LOGOUT');

    socket.on('connect', () => socket.write(cmds.join('\n') + '\n'));
    socket.on('data',    chunk => { buffer += chunk.toString(); });

    const parse = () => {
      const result = { _upsName: upsName };
      for (const line of buffer.split('\n')) {
        const m = line.match(/^VAR \S+ (\S+) "(.*)"/);
        if (m) {
          const raw = m[2];
          result[m[1]] = (raw !== '' && !isNaN(raw)) ? parseFloat(raw) : raw;
        }
      }
      resolve(result);
    };

    socket.on('end',   parse);
    socket.on('close', parse);
    socket.on('error', err  => reject(err));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('NUT connection timed out')); });
  });
}

// ─── UI Server ────────────────────────────────────────────────────────────────
class NUTUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/ups-status', this.handleUpsStatus.bind(this));
    this.ready();
  }

  async handleUpsStatus() {
    try {
      // Read live config from Homebridge so we always use current settings
      const allConfigs = await this.getPluginConfig();
      const cfg = allConfigs.find(c => c.platform === 'NUTDashboard') || {};

      const host     = cfg.host     || '127.0.0.1';
      const port     = cfg.port     || 3493;
      const username = cfg.username || null;
      const password = cfg.password || null;
      const upsList  = Array.isArray(cfg.ups) ? cfg.ups : [cfg.ups || 'ups'];

      const results = await Promise.allSettled(
        upsList.map(upsName => queryNUT(host, port, upsName, username, password))
      );

      const data = results.map((r, i) => {
        if (r.status === 'fulfilled') {
          return r.value;
        }
        return { _upsName: upsList[i], _error: r.reason?.message || 'Unknown error' };
      });

      return {
        success:   true,
        timestamp: new Date().toISOString(),
        host,
        port,
        data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

new NUTUiServer();
