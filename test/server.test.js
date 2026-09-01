'use strict';

/**
 * test/server.test.js
 *
 * Unit tests for homebridge-ui/server.js. The telemetry endpoints (/export,
 * /logs, /outages*, /export-30d, …) share one handler driven by
 * telemetryStore.TELEMETRY_ROUTES, so they are exercised through route dispatch
 * via the request() helper rather than per-endpoint methods. /logs/download and
 * /ups-status keep their own methods and are called directly.
 *
 * We instantiate a minimal stand-in for NUTUiServer without requiring the
 * @homebridge/plugin-ui-utils runtime.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const RingBuffer = require('../lib/ringBuffer');
const { resolveDataDir } = require('../lib/storagePaths');
const telemetryStore     = require('../lib/telemetryStore');

// ── Minimal server stand-in ───────────────────────────────────────────────────
// Pull the handler methods out of server.js without running the full UI
// server bootstrap (which calls `new NUTUiServer()` and `this.ready()`).
// We do this by monkey-patching HomebridgePluginUiServer before requiring.

let capturedInstance;

jest.mock('@homebridge/plugin-ui-utils', () => ({
  HomebridgePluginUiServer: class {
    constructor() { capturedInstance = this; this._routes = {}; }
    onRequest(route, handler) { this._routes[route] = handler; }
    ready()     {}
  },
}));

// Also stub queryNUT so server.js loads without a NUT server available.
jest.mock('../lib/nutClient', () => ({ queryNUT: jest.fn() }));

// Now load server.js — the `new NUTUiServer()` at the bottom runs but is safe.
require('../homebridge-ui/server');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
}

function makeServerCtx(storagePath, configUpsName = 'ups') {
  // Build a minimal config.json so _resolveContext can fall back to it
  const config = {
    platforms: [{ platform: 'NUTDashboard', ups: configUpsName }],
  };
  fs.writeFileSync(path.join(storagePath, 'config.json'), JSON.stringify(config), 'utf8');

  // Reuse the real bootstrapped instance (captured at module load) so requests
  // run through the handlers and routes that server.js actually registered.
  const ctx = capturedInstance;
  ctx.homebridgeStoragePath = storagePath;
  return ctx;
}

// Dispatch a telemetry endpoint exactly as the UI runtime would: by invoking the
// closure server.js registered for that route via onRequest. This exercises the
// registration loop, the generic _handleTelemetry, and telemetryStore.TELEMETRY_ROUTES
// as one path.
function request(ctx, route, body = {}) {
  const handler = ctx._routes[route];
  if (!handler) throw new Error(`no route registered for ${route}`);
  return handler(body);
}

function makePoint(n) {
  return {
    t:       new Date(Date.now() + n * 60000).toISOString(),
    inV:     230 + n,
    outV:    229 + n,
    bat:     80  + n,
    load:    20  + n,
    runtime: 3600 - n * 60,
  };
}

function populateRingBuffer(storagePath, upsName, count = 5) {
  const histFile = path.join(resolveDataDir(storagePath), `ups-history-${upsName}.json`);
  const buf      = new RingBuffer(histFile, 1440);
  for (let i = 0; i < count; i++) buf.push(makePoint(i));
  return buf;
}

function writeDailyLog(storagePath, upsName, dateStr, lines = 3) {
  const filename = `ups-log-${upsName}-${dateStr}.csv`;
  const header   = 'timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min\n';
  const rows     = Array.from({ length: lines }, (_, i) =>
    `${dateStr}T0${i}:00:00.000Z,230,229,90,20,18.50`).join('\n') + '\n';
  const ddir = resolveDataDir(storagePath);
  fs.mkdirSync(ddir, { recursive: true });
  fs.writeFileSync(path.join(ddir, filename), header + rows, 'utf8');
  return filename;
}

function writeOutageLog(storagePath, upsName, events) {
  const ddir = resolveDataDir(storagePath);
  fs.mkdirSync(ddir, { recursive: true });
  fs.writeFileSync(
    path.join(ddir, `ups-outages-${upsName}.json`),
    JSON.stringify({ v: 1, events }),
    'utf8',
  );
}

// ── handleExport ──────────────────────────────────────────────────────────────

describe('POST /export', () => {
  test('returns success with csv string and filename', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    populateRingBuffer(dir, 'ups', 3);

    const resp = await request(ctx, '/export', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('ups');
    expect(typeof resp.csv).toBe('string');
    expect(resp.filename).toMatch(/^ups-ups-\d{4}-\d{2}-\d{2}\.csv$/);

    fs.rmSync(dir, { recursive: true });
  });

  test('CSV has correct header row', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    populateRingBuffer(dir, 'ups', 2);

    const resp  = await request(ctx, '/export', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');

    fs.rmSync(dir, { recursive: true });
  });

  test('CSV has one data row per ring buffer point', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    populateRingBuffer(dir, 'ups', 4);

    const resp  = await request(ctx, '/export', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    // 1 header + 4 data rows
    expect(lines).toHaveLength(5);

    fs.rmSync(dir, { recursive: true });
  });

  test('runtime is converted to minutes in the CSV', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    const histFile = path.join(resolveDataDir(dir), 'ups-history-ups.json');
    const buf = new RingBuffer(histFile, 1440);
    buf.push({ t: new Date().toISOString(), inV: 230, outV: 229, bat: 80, load: 20, runtime: 3600 });

    const resp  = await request(ctx, '/export', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');
    const cols  = lines[1].split(',');

    expect(parseFloat(cols[5])).toBeCloseTo(60, 1);  // 3600s = 60min

    fs.rmSync(dir, { recursive: true });
  });

  test('returns empty csv body when ring buffer has no points', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    // No ring buffer file created — buffer will be empty

    const resp  = await request(ctx, '/export', { upsName: 'ups' });
    expect(resp.success).toBe(true);
    // Only the header line, no data rows
    expect(resp.csv.trim()).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');

    fs.rmSync(dir, { recursive: true });
  });

  test('falls back to config upsName when body.upsName is omitted', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'myups');
    populateRingBuffer(dir, 'myups', 2);

    const resp = await request(ctx, '/export', {});
    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('myups');

    fs.rmSync(dir, { recursive: true });
  });
});

// ── handleLogs ────────────────────────────────────────────────────────────────

describe('POST /logs', () => {
  test('returns success with empty array when no log files exist', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await request(ctx, '/logs', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.files).toEqual([]);

    fs.rmSync(dir, { recursive: true });
  });

  test('lists log files for the given UPS sorted newest first', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-01');
    writeDailyLog(dir, 'ups', '2024-06-03');
    writeDailyLog(dir, 'ups', '2024-06-02');

    const resp = await request(ctx, '/logs', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.files).toHaveLength(3);
    expect(resp.files[0].date).toBe('2024-06-03');
    expect(resp.files[2].date).toBe('2024-06-01');

    fs.rmSync(dir, { recursive: true });
  });

  test('each file entry has filename, date, and sizeBytes', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-01');

    const resp = await request(ctx, '/logs', { upsName: 'ups' });
    const file = resp.files[0];

    expect(file.filename).toBe('ups-log-ups-2024-06-01.csv');
    expect(file.date).toBe('2024-06-01');
    expect(typeof file.sizeBytes).toBe('number');
    expect(file.sizeBytes).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true });
  });

  test('does not list log files belonging to a different UPS', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups',   '2024-06-01');
    writeDailyLog(dir, 'other', '2024-06-01');

    const resp = await request(ctx, '/logs', { upsName: 'ups' });

    expect(resp.files).toHaveLength(1);
    expect(resp.files[0].filename).toContain('ups-log-ups-');

    fs.rmSync(dir, { recursive: true });
  });
});

// ── handleLogsDownload ────────────────────────────────────────────────────────

describe('handleLogsDownload', () => {
  test('returns csv content for a valid file', async () => {
    const dir      = tmpDir();
    const ctx      = makeServerCtx(dir, 'ups');
    const filename = writeDailyLog(dir, 'ups', '2024-06-01');

    const resp = await ctx.handleLogsDownload({ upsName: 'ups', filename });

    expect(resp.success).toBe(true);
    expect(resp.filename).toBe(filename);
    expect(resp.csv).toContain('timestamp,input_voltage');

    fs.rmSync(dir, { recursive: true });
  });

  test('returns error when filename is missing', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleLogsDownload({ upsName: 'ups' });

    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/filename is required/i);

    fs.rmSync(dir, { recursive: true });
  });

  test('rejects filenames with path traversal characters', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleLogsDownload({
      upsName: 'ups',
      filename: '../etc/passwd',
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/invalid filename/i);

    fs.rmSync(dir, { recursive: true });
  });

  test('rejects filenames that do not match the expected pattern', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleLogsDownload({
      upsName: 'ups',
      filename: 'ups-log-ups-not-a-date.csv',
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/invalid filename/i);

    fs.rmSync(dir, { recursive: true });
  });

  test('returns error when file does not exist', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleLogsDownload({
      upsName: 'ups',
      filename: 'ups-log-ups-2024-01-01.csv',
    });

    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/not found/i);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── handleOutages ───────────────────────────────────────────────────────────

describe('POST /outages', () => {
  test('returns latest outage and timeline events', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeOutageLog(dir, 'ups', [{
      id: '2026-06-05T01:00:00.000Z',
      upsName: 'ups',
      start: '2026-06-05T01:00:00.000Z',
      end: '2026-06-05T01:05:00.000Z',
      durationSec: 300,
      ongoing: false,
      acknowledged: false,
      acknowledgedAt: null,
      startBattery: 90,
      endBattery: 84,
      lowestBattery: 84,
      lowBattery: false,
    }]);

    const resp = await request(ctx, '/outages', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.latest.durationSec).toBe(300);
    expect(resp.events).toHaveLength(1);

    fs.rmSync(dir, { recursive: true });
  });

  test('acknowledges the latest outage without deleting it', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeOutageLog(dir, 'ups', [{
      id: '2026-06-05T01:00:00.000Z',
      upsName: 'ups',
      start: '2026-06-05T01:00:00.000Z',
      end: '2026-06-05T01:05:00.000Z',
      durationSec: 300,
      ongoing: false,
      acknowledged: false,
      acknowledgedAt: null,
      startBattery: 90,
      endBattery: 84,
      lowestBattery: 84,
      lowBattery: false,
    }]);

    const resp = await request(ctx, '/outages/acknowledge', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.acknowledged).toBe(true);
    expect(resp.latest.acknowledged).toBe(true);
    expect(resp.events).toHaveLength(1);

    fs.rmSync(dir, { recursive: true });
  });

  test('clears outage history without removing daily logs', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2026-06-05');
    writeOutageLog(dir, 'ups', [{
      id: '2026-06-05T01:00:00.000Z',
      upsName: 'ups',
      start: '2026-06-05T01:00:00.000Z',
      end: null,
      durationSec: null,
      ongoing: true,
      acknowledged: false,
      acknowledgedAt: null,
      startBattery: 90,
      endBattery: null,
      lowestBattery: 90,
      lowBattery: false,
    }]);

    const resp = await request(ctx, '/outages/clear', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.cleared).toBe(1);
    expect(resp.events).toEqual([]);
    expect(fs.existsSync(path.join(resolveDataDir(dir), 'ups-log-ups-2026-06-05.csv'))).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  test('exports outage history as CSV', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeOutageLog(dir, 'ups', [{
      id: '2026-06-05T01:00:00.000Z',
      upsName: 'ups',
      start: '2026-06-05T01:00:00.000Z',
      end: '2026-06-05T01:05:00.000Z',
      durationSec: 300,
      ongoing: false,
      acknowledged: true,
      acknowledgedAt: '2026-06-05T01:06:00.000Z',
      startBattery: 90,
      endBattery: 84,
      lowestBattery: 84,
      lowBattery: false,
    }]);

    const resp = await request(ctx, '/outages/export', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('ups');
    expect(resp.filename).toMatch(/^ups-ups-outages-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(resp.csv).toContain('ups_name,start,end,duration_sec');
    expect(resp.csv).toContain('ups,2026-06-05T01:00:00.000Z,2026-06-05T01:05:00.000Z,300,false,true');

    fs.rmSync(dir, { recursive: true });
  });
});

// ── handleExport30d ───────────────────────────────────────────────────────────

describe('POST /export-30d', () => {
  test('returns success with header-only csv when no daily logs exist', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await request(ctx, '/export-30d', { upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('ups');
    expect(resp.csv.trim()).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
    expect(resp.filename).toMatch(/^ups-ups-30d-\d{4}-\d{2}-\d{2}\.csv$/);

    fs.rmSync(dir, { recursive: true });
  });

  test('aggregates multiple daily log files into a single CSV', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-01', 3);
    writeDailyLog(dir, 'ups', '2024-06-02', 2);

    const resp  = await request(ctx, '/export-30d', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    // 1 header + 3 rows from day 1 + 2 rows from day 2
    expect(lines).toHaveLength(6);

    fs.rmSync(dir, { recursive: true });
  });

  test('output has exactly one header row even with multiple files', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-01', 2);
    writeDailyLog(dir, 'ups', '2024-06-02', 2);
    writeDailyLog(dir, 'ups', '2024-06-03', 2);

    const resp  = await request(ctx, '/export-30d', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    const headers = lines.filter(l => l.startsWith('timestamp,'));
    expect(headers).toHaveLength(1);
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');

    fs.rmSync(dir, { recursive: true });
  });

  test('data rows are in chronological order (oldest file first)', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-03', 1);
    writeDailyLog(dir, 'ups', '2024-06-01', 1);
    writeDailyLog(dir, 'ups', '2024-06-02', 1);

    const resp  = await request(ctx, '/export-30d', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n').slice(1); // skip header

    expect(lines[0]).toContain('2024-06-01');
    expect(lines[1]).toContain('2024-06-02');
    expect(lines[2]).toContain('2024-06-03');

    fs.rmSync(dir, { recursive: true });
  });

  test('does not include log files belonging to a different UPS', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups',   '2024-06-01', 2);
    writeDailyLog(dir, 'other', '2024-06-01', 5);

    const resp  = await request(ctx, '/export-30d', { upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    // 1 header + 2 rows from 'ups' only
    expect(lines).toHaveLength(3);

    fs.rmSync(dir, { recursive: true });
  });

  test('falls back to config upsName when body.upsName is omitted', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'myups');
    writeDailyLog(dir, 'myups', '2024-06-01', 1);

    const resp = await request(ctx, '/export-30d', {});

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('myups');

    fs.rmSync(dir, { recursive: true });
  });

  test('filename includes upsName, 30d marker, and today\'s date', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'cyberpower');

    const resp = await request(ctx, '/export-30d', { upsName: 'cyberpower' });

    expect(resp.filename).toMatch(/^ups-cyberpower-30d-\d{4}-\d{2}-\d{2}\.csv$/);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── POST /ups-status (issue #237: surface NUT errors with diagnostics) ────────

describe('POST /ups-status — NUT protocol error handling', () => {
  test('a successful query has no error fields', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockResolvedValueOnce({ 'ups.status': 'OL', 'battery.charge': 90 });

    const resp = await ctx.handleUpsStatus();
    expect(resp.success).toBe(true);
    const [entry] = resp.data;
    expect(entry._error).toBeUndefined();
    expect(entry._lastKnownGood).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });

  test('a NUTQueryError-shaped rejection is surfaced with code/category/retryable/guidance', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockRejectedValueOnce(Object.assign(new Error('UNKNOWN-UPS'), {
      code: 'UNKNOWN-UPS', category: 'unknown-ups', retryable: false,
      guidance: 'NUT UPS names are case-sensitive.',
    }));

    const resp = await ctx.handleUpsStatus();
    const [entry] = resp.data;
    expect(entry._upsName).toBe('ups');
    expect(entry._error).toBe('UNKNOWN-UPS');
    expect(entry._errorCode).toBe('UNKNOWN-UPS');
    expect(entry._errorCategory).toBe('unknown-ups');
    expect(entry._retryable).toBe(false);
    expect(entry._guidance).toBe('NUT UPS names are case-sensitive.');

    fs.rmSync(dir, { recursive: true });
  });

  test('a plain Error rejection surfaces _error with null structured fields', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const resp = await ctx.handleUpsStatus();
    const [entry] = resp.data;
    expect(entry._error).toBe('connect ECONNREFUSED');
    expect(entry._errorCode).toBeNull();
    expect(entry._errorCategory).toBeNull();
    expect(entry._retryable).toBeNull();
    expect(entry._guidance).toBeNull();

    fs.rmSync(dir, { recursive: true });
  });

  test('_lastKnownGood carries the most recent persisted telemetry point when a query fails', async () => {
    const dir = tmpDir();
    populateRingBuffer(dir, 'ups', 3); // points 0, 1, 2 — point 2 is most recent
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
      code: 'DATA-STALE', category: 'stale-data', retryable: true,
    }));

    const resp = await ctx.handleUpsStatus();
    const [entry] = resp.data;
    // Compare everything but `t` exactly (makePoint() stamps it with
    // Date.now() at call time, which can differ by a millisecond from when
    // populateRingBuffer() generated the seeded point) and just check `t`
    // is present as a string.
    const expected = makePoint(2);
    expect(entry._lastKnownGood).toMatchObject({
      inV: expected.inV, outV: expected.outV, bat: expected.bat,
      load: expected.load, runtime: expected.runtime,
    });
    expect(typeof entry._lastKnownGood.t).toBe('string');

    fs.rmSync(dir, { recursive: true });
  });

  test('_lastKnownGood skips a trailing all-null legacy point and returns the last usable reading (#241)', async () => {
    const dir = tmpDir();
    const buf = populateRingBuffer(dir, 'ups', 2); // points 0, 1 — point 1 is the newest usable one
    // Pre-#238 all-null point, as a failed poll could still push before the telemetry-integrity fix.
    buf.push({
      t: new Date(Date.now() + 5 * 60000).toISOString(),
      inV: null, outV: null, bat: null, load: null, runtime: null,
    });
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
      code: 'DATA-STALE', category: 'stale-data', retryable: true,
    }));

    const resp = await ctx.handleUpsStatus();
    const [entry] = resp.data;
    const expected = makePoint(1);
    expect(entry._lastKnownGood).toMatchObject({
      inV: expected.inV, outV: expected.outV, bat: expected.bat,
      load: expected.load, runtime: expected.runtime,
    });

    fs.rmSync(dir, { recursive: true });
  });

  test('_lastKnownGood is null when no history has been recorded yet', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    require('../lib/nutClient').queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
      code: 'DATA-STALE', category: 'stale-data', retryable: true,
    }));

    const resp = await ctx.handleUpsStatus();
    expect(resp.data[0]._lastKnownGood).toBeNull();

    fs.rmSync(dir, { recursive: true });
  });
});

// ── Route registration ────────────────────────────────────────────────────────

describe('route registration', () => {
  test('registers a handler for every telemetry route', () => {
    const registered = Object.keys(capturedInstance._routes);
    for (const route of telemetryStore.TELEMETRY_ROUTES.keys()) {
      expect(registered).toContain(route);
    }
  });

  test('registers the transport-specific endpoints', () => {
    const registered = Object.keys(capturedInstance._routes);
    expect(registered).toContain('/ups-status');
    expect(registered).toContain('/logs/download');
  });

  test('does not register /logs/download as a shared telemetry route', () => {
    expect([...telemetryStore.TELEMETRY_ROUTES.keys()]).not.toContain('/logs/download');
  });
});
