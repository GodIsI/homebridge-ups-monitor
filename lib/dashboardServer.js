'use strict';

/**
 * lib/dashboardServer.js
 *
 * Standalone HTTP server that serves the UPS dashboard as a local website.
 * Configured via `standalonePort` in the plugin config.
 *
 * Endpoints:
 *   GET  /              → serves homebridge-ui/public/dashboard.html
 *   POST /ups-status    → queries NUT and returns JSON
 *   POST /history       → returns 24h ring-buffer points
 *   POST /export        → returns 24h ring-buffer as CSV
 *   POST /export-30d    → aggregates 30-day daily logs into CSV
 *   POST /outages       → returns outage timeline events
 *   POST /outages/acknowledge → acknowledges the latest outage
 *   POST /outages/clear → clears outage timeline events
 *   POST /outages/export → returns outage timeline as CSV
 *   POST /logs          → lists available daily log files
 *   POST /logs/download → returns one daily log file as CSV
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { queryNUT } = require('./nutClient');
const telemetryStore = require('./telemetryStore');

const HTML_FILE   = path.join(__dirname, '..', 'homebridge-ui', 'public', 'dashboard.html');
const PUBLIC_DIR  = path.join(__dirname, '..', 'homebridge-ui', 'public');
// Whitelisted static assets served alongside the dashboard (no directory traversal).
const STATIC_ASSETS = {
  '/vendor/chart.umd.min.js':    { file: 'vendor/chart.umd.min.js',     type: 'application/javascript; charset=utf-8' },
  '/manifest.webmanifest':       { file: 'manifest.webmanifest',        type: 'application/manifest+json; charset=utf-8' },
  '/icons/icon.svg':             { file: 'icons/icon.svg',              type: 'image/svg+xml; charset=utf-8' },
  '/icons/icon-32.png':          { file: 'icons/icon-32.png',           type: 'image/png' },
  '/icons/icon-192.png':         { file: 'icons/icon-192.png',          type: 'image/png' },
  '/icons/icon-512.png':         { file: 'icons/icon-512.png',          type: 'image/png' },
  '/icons/apple-touch-icon.png': { file: 'icons/apple-touch-icon.png',  type: 'image/png' },
  '/favicon.ico':                { file: 'icons/icon-32.png',           type: 'image/png' },
};

class DashboardServer {
  /**
   * @param {object}   cfg
   * @param {string}   cfg.storagePath  Homebridge storage directory
   * @param {string[]} cfg.upsNames     List of UPS names from config
   * @param {string}   cfg.host         NUT server host
   * @param {number}   cfg.nutPort      NUT server port
   * @param {string}   [cfg.username]   NUT username (optional)
   * @param {string}   [cfg.password]   NUT password (optional)
   * @param {object}   cfg.log          Homebridge logger (or console)
   */
  constructor(cfg = {}) {
    this._storagePath = cfg.storagePath || path.join(os.homedir(), '.homebridge');
    this._upsNames    = Array.isArray(cfg.upsNames) ? cfg.upsNames : ['ups'];
    this._host        = cfg.host     || '127.0.0.1';
    this._nutPort     = cfg.nutPort  || 3493;
    this._username    = cfg.username || null;
    this._password    = cfg.password || null;
    this._log         = cfg.log      || console;
    this._server      = null;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the server on the given port (0 = OS-assigned random port).
   * Resolves with the actual bound port number.
   * @param {number} port
   * @returns {Promise<number>}
   */
  start(port) {
    return new Promise((resolve, reject) => {
      this._server = http.createServer(this._handleRequest.bind(this));

      // Reject the start promise only for startup errors (e.g. EADDRINUSE).
      const onStartupError = (err) => reject(err);
      this._server.once('error', onStartupError);

      this._server.listen(port || 0, '0.0.0.0', () => {
        const bound = this._server.address().port;
        // Swap the startup handler for a persistent one so a later socket/server
        // error is logged rather than thrown as an unhandled exception.
        this._server.removeListener('error', onStartupError);
        this._server.on('error', (err) => {
          this._log.error(`[UPS Dashboard] Server error: ${err.message}`);
        });
        this._log.info(`[UPS Dashboard] Standalone dashboard running on port ${bound}`);
        this._log.info(`[UPS Dashboard] Open: http://localhost:${bound}`);
        this._log.info(`[UPS Dashboard] Open: http://homebridge.local:${bound}`);
        resolve(bound);
      });
    });
  }

  /** Gracefully stop the server. */
  stop() {
    return new Promise((resolve) => {
      if (this._server) {
        this._server.close(() => resolve());
        this._server = null;
      } else {
        resolve();
      }
    });
  }

  // ─── Request router ────────────────────────────────────────────────────────

  _handleRequest(req, res) {
    const url = (req.url || '/').split('?')[0];

    // Serve dashboard HTML
    if (req.method === 'GET' && url === '/') {
      return this._serveHtml(res);
    }

    // Serve whitelisted static assets (e.g. the vendored Chart.js bundle)
    if (req.method === 'GET' && STATIC_ASSETS[url]) {
      return this._serveAsset(res, STATIC_ASSETS[url]);
    }

    // All API endpoints are POST
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', async () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* ignore malformed JSON */ }

        let result;
        try {
          if (url === '/ups-status') {
            result = await this._handleUpsStatus(body);
          } else if (url === '/logs/download') {
            result = await this._handleLogsDownload(body);
          } else if (telemetryStore.TELEMETRY_ROUTES.has(url)) {
            result = this._handleTelemetry(url, body);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Not found' }));
            return;
          }
        } catch (err) {
          result = { success: false, error: err.message };
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(result));
      });
      return;
    }

    // OPTIONS preflight (CORS)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  }

  _serveHtml(res) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (_err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Dashboard HTML not found');
    }
  }

  /** Serve a whitelisted static asset from the public directory. */
  _serveAsset(res, asset) {
    try {
      const body = fs.readFileSync(path.join(PUBLIC_DIR, asset.file));
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=86400' });
      res.end(body);
    } catch (_err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset not found');
    }
  }

  // ─── Shared helper ─────────────────────────────────────────────────────────

  /**
   * Resolve upsName from request body, defaulting to the first configured UPS.
   * @param {object} body
   * @returns {string}
   */
  _resolveUpsName(body = {}) {
    return body.upsName || this._upsNames[0] || 'ups';
  }

  // ─── Endpoint handlers ─────────────────────────────────────────────────────

  async _handleUpsStatus(_body = {}) {
    const results = await Promise.allSettled(
      this._upsNames.map(upsName =>
        queryNUT(this._host, this._nutPort, upsName, this._username, this._password)
          .then(data => ({ _upsName: upsName, ...data }))
      )
    );

    const data = results.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : this._errorPayload(this._upsNames[i], r.reason));

    return {
      success:   true,
      timestamp: new Date().toISOString(),
      host:      this._host,
      port:      this._nutPort,
      data,
    };
  }

  /**
   * Build the per-UPS error payload for a failed /ups-status query. Folds in
   * whatever structure a NUTQueryError (lib/nutClient.js) carries — code,
   * category, retryable, guidance — so the dashboard can show more than a raw
   * message, and attaches the last successful telemetry point (if any) so the
   * UI can keep showing a real reading, marked as stale, instead of going blank.
   */
  _errorPayload(upsName, reason) {
    return {
      _upsName:        upsName,
      _error:          reason?.message || 'Unknown error',
      _errorCode:      reason?.code || null,
      _errorCategory:  reason?.category || null,
      _retryable:      typeof reason?.retryable === 'boolean' ? reason.retryable : null,
      _guidance:       reason?.guidance || null,
      _lastKnownGood:  this._lastKnownGoodFor(upsName),
    };
  }

  /** Most recent persisted telemetry point for a UPS, or null if none yet. */
  _lastKnownGoodFor(upsName) {
    try {
      const points = telemetryStore.readHistory(this._storagePath, upsName);
      return points.length ? points[points.length - 1] : null;
    } catch {
      return null; // history not readable yet — not fatal, just nothing to show
    }
  }

  /**
   * Generic handler for the telemetry endpoints in telemetryStore.TELEMETRY_ROUTES.
   * Resolves the UPS name and merges the route's payload into the success envelope.
   */
  _handleTelemetry(url, body = {}) {
    const route = telemetryStore.TELEMETRY_ROUTES.get(url);
    if (!route) throw new Error(`Unknown telemetry endpoint: ${url}`);
    const upsName = this._resolveUpsName(body);
    const payload = route(telemetryStore, this._storagePath, upsName);
    return { success: true, upsName, ...payload };
  }

  async _handleLogsDownload(body = {}) {
    return telemetryStore.readLogFile(this._storagePath, body.filename);
  }
}

module.exports = DashboardServer;
