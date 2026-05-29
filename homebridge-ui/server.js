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
 *   POST /logs              → lists available 30-day daily log files for a UPS
 *   POST /logs/download     → returns the contents of one daily log file as CSV
 */

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { queryNUT }  = require('../lib/nutClient');
const RingBuffer    = require('../lib/ringBuffer');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── UI Server ────────────────────────────────────────────────────────────────
class NUTUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/ups-status',     this.handleUpsStatus.bind(this));
    this.onRequest('/history',         this.handleHistory.bind(this));
    this.onRequest('/export',          this.handleExport.bind(this));
    this.onRequest('/export-30d',      this.handleExport30d.bind(this));
    this.onRequest('/logs',            this.handleLogs.bind(this));
    this.onRequest('/logs/download',   this.handleLogsDownload.bind(this));
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

  /**
   * POST /history
   * Body: { upsName?: string }  — defaults to first UPS in config
   *
   * Returns the persistent ring-buffer history written by index.js.
   * No NUT query — pure file read, safe to call frequently.
   *
   * Response:
   *   { success: true,  upsName, points: [{t, inV, outV, bat, load, runtime}] }
   *   { success: false, error }
   */
  async handleHistory(body = {}) {
    try {
      const storagePath = this.homebridgeStoragePath
        || process.env.UIX_STORAGE_PATH
        || path.join(os.homedir(), '.homebridge');

      // Resolve upsName — use body param, or fall back to first UPS in config
      let upsName = body.upsName;
      if (!upsName) {
        const raw    = fs.readFileSync(path.join(storagePath, 'config.json'), 'utf8');
        const cfg    = (JSON.parse(raw).platforms || []).find(p => p.platform === 'NUTDashboard') || {};
        const upsList = Array.isArray(cfg.ups) ? cfg.ups : [cfg.ups || 'ups'];
        upsName = upsList[0];
      }

      const histFile = path.join(storagePath, `ups-history-${upsName}.json`);
      const buf      = new RingBuffer(histFile, 1440);

      return {
        success: true,
        upsName,
        points: buf.read(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  // ── Shared helper ─────────────────────────────────────────────────────────

  /**
   * Resolve storagePath and upsName from body, falling back to config.
   * Returns { storagePath, upsName }.
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

    return { storagePath, upsName };
  }

  /**
   * POST /export
   * Body: { upsName?: string }
   *
   * Returns the 24h ring-buffer as a CSV string so the dashboard can
   * trigger a browser download.
   *
   * Response:
   *   { success: true,  upsName, filename, csv }
   *   { success: false, error }
   *
   * CSV columns: timestamp, input_voltage, output_voltage, battery_pct, load_pct, runtime_min
   */
  async handleExport(body = {}) {
    try {
      const { storagePath, upsName } = this._resolveContext(body);

      const histFile = path.join(storagePath, `ups-history-${upsName}.json`);
      const buf      = new RingBuffer(histFile, 1440);
      const points   = buf.read();

      const header = 'timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min\n';
      const rows   = points.map(p => [
        p.t       ?? '',
        p.inV     ?? '',
        p.outV    ?? '',
        p.bat     ?? '',
        p.load    ?? '',
        p.runtime != null ? (p.runtime / 60).toFixed(2) : '',
      ].join(',')).join('\n');

      const date     = new Date().toISOString().slice(0, 10);
      const filename = `ups-${upsName}-${date}.csv`;

      return {
        success:  true,
        upsName,
        filename,
        csv: header + rows,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * POST /export-30d
   * Body: { upsName?: string }
   *
   * Aggregates all available daily log files for the UPS into a single CSV.
   * Files are sorted oldest → newest so the output is chronological.
   * Duplicate header rows are stripped — only one header appears at the top.
   *
   * Response:
   *   { success: true,  upsName, filename, csv }
   *   { success: false, error }
   *
   * CSV columns (from daily log files): timestamp, input_voltage, output_voltage, load_pct
   */
  async handleExport30d(body = {}) {
    try {
      const { storagePath, upsName } = this._resolveContext(body);

      const prefix = `ups-log-${upsName}-`;
      let logFiles = [];

      try {
        logFiles = fs.readdirSync(storagePath)
          .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
          .sort();  // lexicographic = chronological for YYYY-MM-DD filenames
      } catch {
        // storageDir doesn't exist yet — return header-only CSV
      }

      const HEADER = 'timestamp,input_voltage,output_voltage,load_pct';
      const dataRows = [];

      for (const filename of logFiles) {
        try {
          const content = fs.readFileSync(path.join(storagePath, filename), 'utf8');
          const lines   = content.split('\n');
          // Skip the header line (first line); collect non-empty data rows
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim()) dataRows.push(lines[i]);
          }
        } catch {
          // Skip unreadable files — best-effort
        }
      }

      const csv      = HEADER + (dataRows.length ? '\n' + dataRows.join('\n') : '');
      const date     = new Date().toISOString().slice(0, 10);
      const filename = `ups-${upsName}-30d-${date}.csv`;

      return { success: true, upsName, filename, csv };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * POST /logs
   * Body: { upsName?: string }
   *
   * Lists the available 30-day daily log files for the given UPS,
   * newest first.
   *
   * Response:
   *   { success: true, upsName, files: [{ filename, date, sizeBytes }] }
   *   { success: false, error }
   */
  async handleLogs(body = {}) {
    try {
      const { storagePath, upsName } = this._resolveContext(body);

      const prefix = `ups-log-${upsName}-`;
      let files = [];

      try {
        files = fs.readdirSync(storagePath)
          .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
          .map(filename => {
            const date      = filename.slice(prefix.length, -4);
            const filePath  = path.join(storagePath, filename);
            const sizeBytes = fs.statSync(filePath).size;
            return { filename, date, sizeBytes };
          })
          .sort((a, b) => b.date.localeCompare(a.date));  // newest first
      } catch {
        // storageDir doesn't exist yet — return empty list
      }

      return { success: true, upsName, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * POST /logs/download
   * Body: { upsName?: string, filename: string }
   *
   * Returns the raw CSV content of one daily log file.
   * filename is validated to prevent directory traversal.
   *
   * Response:
   *   { success: true, filename, csv }
   *   { success: false, error }
   */
  async handleLogsDownload(body = {}) {
    try {
      const { storagePath } = this._resolveContext(body);

      const filename = body.filename;
      if (!filename) {
        return { success: false, error: 'filename is required' };
      }

      // Safety: only allow the exact pattern we write, no path separators
      const safe = /^ups-log-[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}\.csv$/.test(filename);
      if (!safe) {
        return { success: false, error: 'Invalid filename' };
      }

      const filePath = path.join(storagePath, filename);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }

      const csv = fs.readFileSync(filePath, 'utf8');
      return { success: true, filename, csv };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

new NUTUiServer();
