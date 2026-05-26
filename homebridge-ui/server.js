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
const { queryNUT } = require('../lib/nutClient');

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
        upsList.map(upsName => queryNUT(host, port, upsName, username, password)
          .then(data => ({ _upsName: upsName, ...data }))
        )
      );

      const data = results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { _upsName: upsList[i], _error: r.reason?.message || 'Unknown error' }
      );

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
