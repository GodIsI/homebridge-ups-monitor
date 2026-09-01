'use strict';

/**
 * lib/telemetryStore.js
 *
 * Shared read/export logic for UPS telemetry, used by both transports:
 *   - lib/dashboardServer.js   (standalone HTTP server)
 *   - homebridge-ui/server.js  (Homebridge custom-UI IPC server)
 *
 * Both previously carried near-identical copies of the history read, CSV export,
 * 30-day aggregation, and log listing/download logic. Centralising it here means
 * the two transports cannot drift apart (a schema change is made once).
 *
 * Every function is pure with respect to its inputs: it takes the resolved data
 * directory (and a UPS name or filename) and returns plain data. Context
 * resolution — how each transport finds the data directory and default UPS —
 * stays in the transport, since the two resolve it very differently.
 */

const fs   = require('fs');
const path = require('path');
const RingBuffer = require('./ringBuffer');
const OutageLog  = require('./outageLog');

/** Canonical CSV column order for telemetry exports. */
const EXPORT_COLUMNS = ['timestamp', 'input_voltage', 'output_voltage', 'battery_pct', 'load_pct', 'runtime_min'];

/** Canonical CSV column order for outage exports. */
const OUTAGE_EXPORT_COLUMNS = [
  'ups_name',
  'start',
  'end',
  'duration_sec',
  'ongoing',
  'acknowledged',
  'acknowledged_at',
  'start_battery_pct',
  'end_battery_pct',
  'lowest_battery_pct',
  'low_battery',
];

/** Reader capacity for ring-buffer files (adopt mode honours the file's own capacity). */
const READER_CAPACITY = 1440;

/** The exact daily-log filename pattern the plugin writes — used to bar traversal. */
const LOG_FILENAME_RE = /^ups-log-[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}\.csv$/;

/** Today's date as YYYY-MM-DD (UTC), used in export filenames. */
function _today() {
  return new Date().toISOString().slice(0, 10);
}

/** Daily-log filename prefix for a given UPS. */
function _logPrefix(upsName) {
  return `ups-log-${upsName}-`;
}

/**
 * Read the persistent ring-buffer history for a UPS.
 * @returns {Array<{t,inV,outV,bat,load,runtime}>} oldest -> newest
 */
function readHistory(dataDir, upsName) {
  const histFile = path.join(dataDir, `ups-history-${upsName}.json`);
  const buf      = new RingBuffer(histFile, READER_CAPACITY, { adopt: true });
  return buf.read();
}

/** Ring-buffer point fields that carry an actual UPS reading (as opposed to just a timestamp). */
const METRIC_KEYS = ['inV', 'outV', 'bat', 'load', 'runtime'];

/** True if a ring-buffer point has at least one non-null/undefined metric. */
function hasUsableMetric(point) {
  if (!point) return false;
  return METRIC_KEYS.some(k => point[k] !== null && point[k] !== undefined);
}

/**
 * Most recent persisted telemetry point for a UPS that actually carries a
 * reading, or null if none exists. Walks backward past the newest point(s)
 * when they're all-null — e.g. a point written before the telemetry-integrity
 * fix in #238, where a failed poll still pushed a timestamp-only point onto
 * the ring buffer. Used by both transports (lib/dashboardServer.js and
 * homebridge-ui/server.js) so "last known good" can't mean "last written,
 * even if it was blank" in one of them and not the other (see #241).
 * @returns {object|null}
 */
function lastKnownGood(dataDir, upsName) {
  let points;
  try {
    points = readHistory(dataDir, upsName);
  } catch {
    return null; // history not readable yet — not fatal, just nothing to show
  }
  for (let i = points.length - 1; i >= 0; i--) {
    if (hasUsableMetric(points[i])) return points[i];
  }
  return null;
}

/**
 * Build the 24h ring-buffer CSV (runtime emitted in minutes).
 * @returns {{ filename: string, csv: string }}
 */
function buildHistoryCsv(dataDir, upsName) {
  const points = readHistory(dataDir, upsName);
  const header = EXPORT_COLUMNS.join(',') + '\n';
  const rows   = points.map(p => [
    p.t       ?? '',
    p.inV     ?? '',
    p.outV    ?? '',
    p.bat     ?? '',
    p.load    ?? '',
    p.runtime != null ? (p.runtime / 60).toFixed(2) : '',
  ].join(',')).join('\n');

  return { filename: `ups-${upsName}-${_today()}.csv`, csv: header + rows };
}

/**
 * Aggregate all daily log files for a UPS into a single CSV, oldest -> newest.
 * Each file is remapped by its own header into the unified EXPORT_COLUMNS schema,
 * so older 4-column logs and newer 6-column logs aggregate cleanly (missing
 * columns left blank).
 * @returns {{ filename: string, csv: string }}
 */
function build30dCsv(dataDir, upsName) {
  const prefix = _logPrefix(upsName);
  let logFiles = [];
  try {
    logFiles = fs.readdirSync(dataDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
      .sort();  // lexicographic = chronological for YYYY-MM-DD filenames
  } catch { /* storageDir not yet created — header-only CSV */ }

  const HEADER   = EXPORT_COLUMNS.join(',');
  const dataRows = [];

  for (const filename of logFiles) {
    try {
      const lines = fs.readFileSync(path.join(dataDir, filename), 'utf8').split('\n');
      if (!lines.length) continue;
      const cols = lines[0].split(',').map(c => c.trim());
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cells  = lines[i].split(',');
        const byName = {};
        cols.forEach((name, idx) => { byName[name] = cells[idx] ?? ''; });
        dataRows.push(EXPORT_COLUMNS.map(name => byName[name] ?? '').join(','));
      }
    } catch { /* skip unreadable files — best-effort */ }
  }

  const csv = HEADER + (dataRows.length ? '\n' + dataRows.join('\n') : '');
  return { filename: `ups-${upsName}-30d-${_today()}.csv`, csv };
}

/**
 * Build outage timeline CSV, newest outage first.
 * @returns {{ filename: string, csv: string }}
 */
function buildOutageCsv(dataDir, upsName) {
  const log = new OutageLog(dataDir, upsName);
  const events = log.list();
  const header = OUTAGE_EXPORT_COLUMNS.join(',');
  const rows = events.map(event => [
    event.upsName ?? upsName,
    event.start ?? '',
    event.end ?? '',
    event.durationSec ?? '',
    Boolean(event.ongoing),
    Boolean(event.acknowledged),
    event.acknowledgedAt ?? '',
    event.startBattery ?? '',
    event.endBattery ?? '',
    event.lowestBattery ?? '',
    Boolean(event.lowBattery),
  ].map(_csvCell).join(','));

  const csv = header + (rows.length ? '\n' + rows.join('\n') : '');
  return { filename: `ups-${upsName}-outages-${_today()}.csv`, csv };
}

/**
 * List available daily log files for a UPS, newest first.
 * @returns {Array<{ filename: string, date: string, sizeBytes: number }>}
 */
function listLogs(dataDir, upsName) {
  const prefix = _logPrefix(upsName);
  try {
    return fs.readdirSync(dataDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
      .map(filename => ({
        filename,
        date:      filename.slice(prefix.length, -4),
        sizeBytes: fs.statSync(path.join(dataDir, filename)).size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];  // storageDir not yet created
  }
}

/**
 * Read one daily log file as CSV. Validates the filename against the exact
 * pattern the plugin writes to bar directory traversal.
 * @returns {{ success: true, filename, csv } | { success: false, error }}
 */
function readLogFile(dataDir, filename) {
  if (!filename) return { success: false, error: 'filename is required' };
  if (!LOG_FILENAME_RE.test(filename)) return { success: false, error: 'Invalid filename' };

  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };

  const csv = fs.readFileSync(filePath, 'utf8');
  return { success: true, filename, csv };
}

/**
 * Read outage timeline events for a UPS, newest first.
 * @returns {{ latest: object|null, events: Array<object> }}
 */
function readOutages(dataDir, upsName) {
  const log = new OutageLog(dataDir, upsName);
  return { latest: log.latest(), events: log.list() };
}

/**
 * Acknowledge the most recent outage without deleting it.
 * @returns {{ acknowledged: boolean, latest: object|null, events: Array<object> }}
 */
function acknowledgeLatestOutage(dataDir, upsName) {
  const log = new OutageLog(dataDir, upsName);
  const acknowledged = log.acknowledgeLatest();
  return { acknowledged, latest: log.latest(), events: log.list() };
}

/**
 * Clear stored outage history for a UPS. Telemetry CSV logs are left untouched.
 * @returns {{ cleared: number, latest: object|null, events: Array<object> }}
 */
function clearOutages(dataDir, upsName) {
  const log = new OutageLog(dataDir, upsName);
  const cleared = log.clear();
  return { cleared, latest: log.latest(), events: log.list() };
}

function _csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Declarative Map of telemetry POST endpoints to the payload each returns.
 * A Map (not a plain object) so a request path can never resolve to an inherited
 * Object.prototype member and dispatch somewhere unexpected.
 * Shared by both transports (lib/dashboardServer.js and homebridge-ui/server.js)
 * so the endpoint-to-store wiring lives in exactly one place and the two
 * servers cannot drift. Each function receives this module plus the resolved
 * data directory and UPS name. The /ups-status and /logs/download endpoints are
 * transport-specific and handled separately.
 */
const TELEMETRY_ROUTES = new Map([
  ['/history',             (store, dir, ups) => ({ points: store.readHistory(dir, ups) })],
  ['/export',              (store, dir, ups) => store.buildHistoryCsv(dir, ups)],
  ['/export-30d',          (store, dir, ups) => store.build30dCsv(dir, ups)],
  ['/logs',                (store, dir, ups) => ({ files: store.listLogs(dir, ups) })],
  ['/outages',             (store, dir, ups) => store.readOutages(dir, ups)],
  ['/outages/acknowledge', (store, dir, ups) => store.acknowledgeLatestOutage(dir, ups)],
  ['/outages/clear',       (store, dir, ups) => store.clearOutages(dir, ups)],
  ['/outages/export',      (store, dir, ups) => store.buildOutageCsv(dir, ups)],
]);

module.exports = {
  EXPORT_COLUMNS,
  TELEMETRY_ROUTES,
  OUTAGE_EXPORT_COLUMNS,
  LOG_FILENAME_RE,
  readHistory,
  hasUsableMetric,
  lastKnownGood,
  buildHistoryCsv,
  build30dCsv,
  buildOutageCsv,
  listLogs,
  readLogFile,
  readOutages,
  acknowledgeLatestOutage,
  clearOutages,
};
