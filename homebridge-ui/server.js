'use strict';

/**
 * homebridge-ui/server.js
 *
 * Runs server-side inside the Homebridge UI process.
 * Handles HTTP requests from the dashboard UI (index.html) via homebridge.request().
 *
 * Endpoints:
 *   POST /ups-status        → queries NUT and returns JSON for all configured UPS units
 *   POST /history           → returns 24h ring-buffer points as JSON
 *   POST /export            → returns 24h ring-buffer as a CSV string
 *   POST /export-30d        → aggregates all 30-day daily logs into a single CSV string
 *   POST /outages           → returns outage timeline events for a UPS
 *   POST /outages/acknowledge → acknowledges the latest outage
 *   POST /outages/clear     → clears outage timeline events for a UPS
 *   POST /outages/export    → returns outage timeline as CSV
 *   POST /logs              → lists available 30-day daily log files for a UPS
 *   POST /logs/download     → returns the contents of one daily log file as CSV
 *
 * The /history, /export, /export-30d, /logs and /outages* endpoints share a
 * single handler driven by telemetryStore.TELEMETRY_ROUTES, so this transport
 * and the standalone server (lib/dashboardServer.js) stay in lockstep. The
 * /ups-status and /logs/download endpoints have transport-specific behaviour and
 * are handled directly.
 */

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { queryNUT }  = require('../lib/nutClient');
const telemetryStore = require('../lib/telemetryStore');
const { resolveDataDir } = require('../lib/storagePaths');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── UI Server ────────────────────────────────────────────────────────────────
class NUTUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/ups-status',    this.handleUpsStatus.bind(this));
    this.onRequest('/logs/download', this.handleLogsDownload.bind(this));
    // Every other telemetry endpoint shares one handler (see telemetryStore.TELEMETRY_ROUTES).
    for (const route of telemetryStore.TELEMETRY_ROUTES.keys()) {
      this.onRequest(route, body => this._handleTelemetry(route, body));
    }
    this.ready();
  }

  async handleUpsStatus() {
    try {
      // Read config directly from config.json — compatible with all UI utils versions
      const storagePath = this.homebridgeStoragePath
        || process.env.UIX_STORAGE_PATH
        || path.join(os.homedir(), '.homebridge');
      const raw = fs.readFileSync(path.join(storagePath, 'config.json'), 'utf8');
      const homebridgeConfig = JSON.parse(raw);
      const cfg = (homebridgeConfig.platforms || []).find(p => p.platform === 'NUTDashboard') || {};

      const host     = cfg.host     || '127.0.0.1';
      const port     = cfg.port     || 3493;
      const username = cfg.username || null;
      const password = cfg.password || null;
      const upsList  = Array.isArray(cfg.ups) ? cfg.ups : [cfg.ups || 'ups'];

      const dataDir = resolveDataDir(storagePath);

      const results = await Promise.allSettled(
        upsList.map(upsName => queryNUT(host, port, upsName, username, password)
          .then(data => ({ _upsName: upsName, ...data }))
        )
      );

      const data = results.map((r, i) => r.status === 'fulfilled'
        ? r.value
        : this._errorPayload(dataDir, upsList[i], r.reason));

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

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /**
   * Build the per-UPS error payload for a failed /ups-status query. Folds in
   * whatever structure a NUTQueryError (lib/nutClient.js) carries — code,
   * category, retryable, guidance — so the dashboard can show more than a raw
   * message, and attaches the last successful telemetry point (if any) so the
   * UI can keep showing a real reading, marked as stale, instead of going blank.
   */
  _errorPayload(dataDir, upsName, reason) {
    return {
      _upsName:        upsName,
      _error:          reason?.message || 'Unknown error',
      _errorCode:      reason?.code || null,
      _errorCategory:  reason?.category || null,
      _retryable:      typeof reason?.retryable === 'boolean' ? reason.retryable : null,
      _guidance:       reason?.guidance || null,
      _lastKnownGood:  this._lastKnownGoodFor(dataDir, upsName),
    };
  }

  /**
   * Most recent persisted telemetry point for a UPS that actually carries a
   * reading (see telemetryStore.lastKnownGood for why "last written" isn't
   * good enough), or null if none exists.
   */
  _lastKnownGoodFor(dataDir, upsName) {
    return telemetryStore.lastKnownGood(dataDir, upsName);
  }

  /**
   * Resolve storagePath, dataDir and upsName from the request body, falling back
   * to the first UPS in config.json when the body omits upsName.
   * @returns {{ storagePath: string, dataDir: string, upsName: string }}
   */
  _resolveContext(body = {}) {
    const storagePath = this.homebridgeStoragePath
      || process.env.UIX_STORAGE_PATH
      || path.join(os.homedir(), '.homebridge');

    let upsName = body.upsName;
    if (!upsName) {
      const raw     = fs.readFileSync(path.join(storagePath, 'config.json'), 'utf8');
      const cfg     = (JSON.parse(raw).platforms || []).find(p => p.platform === 'NUTDashboard') || {};
      const upsList = Array.isArray(cfg.ups) ? cfg.ups : [cfg.ups || 'ups'];
      upsName = upsList[0];
    }

    return { storagePath, dataDir: resolveDataDir(storagePath), upsName };
  }

  /**
   * Generic handler for the telemetry endpoints in telemetryStore.TELEMETRY_ROUTES
   * (/history, /export, /export-30d, /logs, /outages*). Resolves context and
   * merges the route's payload into the success envelope.
   */
  _handleTelemetry(route, body = {}) {
    try {
      const fn = telemetryStore.TELEMETRY_ROUTES.get(route);
      if (!fn) throw new Error(`Unknown telemetry endpoint: ${route}`);
      const { dataDir, upsName } = this._resolveContext(body);
      const payload = fn(telemetryStore, dataDir, upsName);
      return { success: true, upsName, ...payload };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * POST /logs/download
   * Body: { upsName?: string, filename: string }
   *
   * Returns the raw CSV content of one daily log file. filename is validated by
   * telemetryStore.readLogFile to prevent directory traversal.
   *
   * Response:
   *   { success: true, filename, csv }
   *   { success: false, error }
   */
  async handleLogsDownload(body = {}) {
    try {
      const { dataDir } = this._resolveContext(body);
      return telemetryStore.readLogFile(dataDir, body.filename);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

new NUTUiServer();
