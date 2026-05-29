'use strict';

/**
 * test/server.test.js
 *
 * Unit tests for the three new homebridge-ui/server.js handlers:
 *   handleExport        — POST /export
 *   handleLogs          — POST /logs
 *   handleLogsDownload  — POST /logs/download
 *
 * We test the handler methods directly by instantiating a minimal stand-in
 * for NUTUiServer that exposes the same helpers without requiring the
 * @homebridge/plugin-ui-utils runtime.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const RingBuffer = require('../lib/ringBuffer');

// ── Minimal server stand-in ───────────────────────────────────────────────────
// Pull the handler methods out of server.js without running the full UI
// server bootstrap (which calls `new NUTUiServer()` and `this.ready()`).
// We do this by monkey-patching HomebridgePluginUiServer before requiring.

let capturedInstance;

jest.mock('@homebridge/plugin-ui-utils', () => ({
  HomebridgePluginUiServer: class {
    constructor() { capturedInstance = this; }
    onRequest() {}
    ready()     {}
  },
}));

// Also stub queryNUT so server.js loads without a NUT server available.
jest.mock('../lib/nutClient', () => ({ queryNUT: jest.fn() }));

// Now load server.js — the `new NUTUiServer()` at the bottom runs but is safe.
require('../homebridge-ui/server');

// Grab the prototype so we can call handlers with a controlled `this`.
const NUTUiServer = capturedInstance.constructor;

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

  const ctx = Object.create(NUTUiServer.prototype);
  ctx.homebridgeStoragePath = storagePath;
  return ctx;
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
  const histFile = path.join(storagePath, `ups-history-${upsName}.json`);
  const buf      = new RingBuffer(histFile, 1440);
  for (let i = 0; i < count; i++) buf.push(makePoint(i));
  return buf;
}

function writeDailyLog(storagePath, upsName, dateStr, lines = 3) {
  const filename = `ups-log-${upsName}-${dateStr}.csv`;
  const header   = 'timestamp,input_voltage,output_voltage,load_pct\n';
  const rows     = Array.from({ length: lines }, (_, i) =>
    `${dateStr}T0${i}:00:00.000Z,230,229,20`).join('\n') + '\n';
  fs.writeFileSync(path.join(storagePath, filename), header + rows, 'utf8');
  return filename;
}

// ── handleExport ──────────────────────────────────────────────────────────────

describe('handleExport', () => {
  test('returns success with csv string and filename', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    populateRingBuffer(dir, 'ups', 3);

    const resp = await ctx.handleExport({ upsName: 'ups' });

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

    const resp  = await ctx.handleExport({ upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');

    fs.rmSync(dir, { recursive: true });
  });

  test('CSV has one data row per ring buffer point', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    populateRingBuffer(dir, 'ups', 4);

    const resp  = await ctx.handleExport({ upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    // 1 header + 4 data rows
    expect(lines).toHaveLength(5);

    fs.rmSync(dir, { recursive: true });
  });

  test('runtime is converted to minutes in the CSV', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    const histFile = path.join(dir, 'ups-history-ups.json');
    const buf = new RingBuffer(histFile, 1440);
    buf.push({ t: new Date().toISOString(), inV: 230, outV: 229, bat: 80, load: 20, runtime: 3600 });

    const resp  = await ctx.handleExport({ upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');
    const cols  = lines[1].split(',');

    expect(parseFloat(cols[5])).toBeCloseTo(60, 1);  // 3600s = 60min

    fs.rmSync(dir, { recursive: true });
  });

  test('returns empty csv body when ring buffer has no points', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    // No ring buffer file created — buffer will be empty

    const resp  = await ctx.handleExport({ upsName: 'ups' });
    expect(resp.success).toBe(true);
    // Only the header line, no data rows
    expect(resp.csv.trim()).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');

    fs.rmSync(dir, { recursive: true });
  });

  test('falls back to config upsName when body.upsName is omitted', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'myups');
    populateRingBuffer(dir, 'myups', 2);

    const resp = await ctx.handleExport({});
    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('myups');

    fs.rmSync(dir, { recursive: true });
  });
});

// ── handleLogs ────────────────────────────────────────────────────────────────

describe('handleLogs', () => {
  test('returns success with empty array when no log files exist', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleLogs({ upsName: 'ups' });

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

    const resp = await ctx.handleLogs({ upsName: 'ups' });

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

    const resp = await ctx.handleLogs({ upsName: 'ups' });
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

    const resp = await ctx.handleLogs({ upsName: 'ups' });

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

// ── handleExport30d ───────────────────────────────────────────────────────────

describe('handleExport30d', () => {
  test('returns success with header-only csv when no daily logs exist', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');

    const resp = await ctx.handleExport30d({ upsName: 'ups' });

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('ups');
    expect(resp.csv.trim()).toBe('timestamp,input_voltage,output_voltage,load_pct');
    expect(resp.filename).toMatch(/^ups-ups-30d-\d{4}-\d{2}-\d{2}\.csv$/);

    fs.rmSync(dir, { recursive: true });
  });

  test('aggregates multiple daily log files into a single CSV', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-01', 3);
    writeDailyLog(dir, 'ups', '2024-06-02', 2);

    const resp  = await ctx.handleExport30d({ upsName: 'ups' });
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

    const resp  = await ctx.handleExport30d({ upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    const headers = lines.filter(l => l.startsWith('timestamp,'));
    expect(headers).toHaveLength(1);
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,load_pct');

    fs.rmSync(dir, { recursive: true });
  });

  test('data rows are in chronological order (oldest file first)', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'ups');
    writeDailyLog(dir, 'ups', '2024-06-03', 1);
    writeDailyLog(dir, 'ups', '2024-06-01', 1);
    writeDailyLog(dir, 'ups', '2024-06-02', 1);

    const resp  = await ctx.handleExport30d({ upsName: 'ups' });
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

    const resp  = await ctx.handleExport30d({ upsName: 'ups' });
    const lines = resp.csv.trim().split('\n');

    // 1 header + 2 rows from 'ups' only
    expect(lines).toHaveLength(3);

    fs.rmSync(dir, { recursive: true });
  });

  test('falls back to config upsName when body.upsName is omitted', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'myups');
    writeDailyLog(dir, 'myups', '2024-06-01', 1);

    const resp = await ctx.handleExport30d({});

    expect(resp.success).toBe(true);
    expect(resp.upsName).toBe('myups');

    fs.rmSync(dir, { recursive: true });
  });

  test('filename includes upsName, 30d marker, and today\'s date', async () => {
    const dir = tmpDir();
    const ctx = makeServerCtx(dir, 'cyberpower');

    const resp = await ctx.handleExport30d({ upsName: 'cyberpower' });

    expect(resp.filename).toMatch(/^ups-cyberpower-30d-\d{4}-\d{2}-\d{2}\.csv$/);

    fs.rmSync(dir, { recursive: true });
  });
});
