'use strict';

/**
 * test/dashboardServer.test.js
 *
 * Integration tests for lib/dashboardServer.js.
 * Spins up a real HTTP server on an OS-assigned port, exercises every
 * endpoint with actual HTTP requests, and tears the server down after.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const http = require('http');

const RingBuffer      = require('../lib/ringBuffer');
const DashboardServer = require('../lib/dashboardServer');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-test-'));
}

/** Minimal HTTP POST helper — returns parsed JSON body. */
function post(port, urlPath, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Minimal HTTP GET helper — returns { status, body: string }. */
function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

// Stub queryNUT so tests don't need a live NUT server
jest.mock('../lib/nutClient', () => ({
  queryNUT: jest.fn().mockResolvedValue({
    'ups.status': 'OL',
    'battery.charge': '100',
    'ups.load': '15',
    'input.voltage': '230',
    'output.voltage': '230',
    'battery.runtime': '3600',
  }),
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe('DashboardServer', () => {
  let server;
  let port;
  let storageDir;

  beforeEach(async () => {
    storageDir = tmpDir();
    server = new DashboardServer({
      storagePath: storageDir,
      upsNames:    ['testups'],
      host:        '127.0.0.1',
      nutPort:     3493,
      log:         { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    });
    port = await server.start(0);  // port 0 = OS-assigned
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  test('start() resolves with a valid port number', () => {
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test('stop() closes the server gracefully', async () => {
    await server.stop();
    // Second stop should not throw
    await expect(server.stop()).resolves.toBeUndefined();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  test('GET / returns 200 with HTML content-type', async () => {
    const { status, body } = await get(port, '/');
    expect(status).toBe(200);
    expect(body).toMatch(/<html/i);
  });

  // ── Unknown routes ─────────────────────────────────────────────────────────

  test('POST /unknown returns 404', async () => {
    const { status, body } = await post(port, '/no-such-endpoint');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  // ── POST /ups-status ──────────────────────────────────────────────────────

  test('POST /ups-status returns success with data array', async () => {
    const { status, body } = await post(port, '/ups-status');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]._upsName).toBe('testups');
  });

  // ── POST /history ─────────────────────────────────────────────────────────

  test('POST /history returns empty points when no history file exists', async () => {
    const { status, body } = await post(port, '/history');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.upsName).toBe('testups');
    expect(Array.isArray(body.points)).toBe(true);
  });

  test('POST /history returns persisted points from ring buffer', async () => {
    // Write some data to the ring buffer
    const histFile = path.join(storageDir, 'ups-history-testups.json');
    const buf = new RingBuffer(histFile, 1440);
    buf.push({ t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 228, bat: 100, load: 10, runtime: 3600 });
    buf.push({ t: '2024-01-01T00:01:00.000Z', inV: 231, outV: 229, bat: 99,  load: 11, runtime: 3540 });

    const { status, body } = await post(port, '/history', { upsName: 'testups' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.points.length).toBe(2);
    expect(body.points[0].inV).toBe(230);
  });

  // ── POST /export ──────────────────────────────────────────────────────────

  test('POST /export returns CSV string with header', async () => {
    const { status, body } = await post(port, '/export');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.csv).toMatch(/^timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min/);
    expect(typeof body.filename).toBe('string');
    expect(body.filename).toMatch(/\.csv$/);
  });

  test('POST /export CSV contains data rows when ring buffer has points', async () => {
    const histFile = path.join(storageDir, 'ups-history-testups.json');
    const buf = new RingBuffer(histFile, 1440);
    buf.push({ t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 228, bat: 100, load: 10, runtime: 3600 });

    const { body } = await post(port, '/export', { upsName: 'testups' });
    expect(body.success).toBe(true);
    const lines = body.csv.trim().split('\n');
    expect(lines.length).toBe(2);  // header + 1 data row
    expect(lines[1]).toMatch(/^2024-01-01/);
  });

  // ── POST /export-30d ──────────────────────────────────────────────────────

  test('POST /export-30d returns header-only CSV when no log files exist', async () => {
    const { status, body } = await post(port, '/export-30d');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.csv).toBe('timestamp,input_voltage,output_voltage,load_pct');
  });

  test('POST /export-30d aggregates multiple daily log files', async () => {
    const header = 'timestamp,input_voltage,output_voltage,load_pct\n';
    fs.writeFileSync(
      path.join(storageDir, 'ups-log-testups-2024-01-01.csv'),
      header + '2024-01-01T00:00:00.000Z,230,228,10\n'
    );
    fs.writeFileSync(
      path.join(storageDir, 'ups-log-testups-2024-01-02.csv'),
      header + '2024-01-02T00:00:00.000Z,229,227,12\n'
    );

    const { body } = await post(port, '/export-30d', { upsName: 'testups' });
    expect(body.success).toBe(true);
    const lines = body.csv.trim().split('\n');
    expect(lines.length).toBe(3);  // header + 2 data rows
    expect(body.csv).toContain('2024-01-01');
    expect(body.csv).toContain('2024-01-02');
  });

  // ── POST /logs ────────────────────────────────────────────────────────────

  test('POST /logs returns empty array when no log files exist', async () => {
    const { status, body } = await post(port, '/logs');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.upsName).toBe('testups');
    expect(body.files).toEqual([]);
  });

  test('POST /logs lists files newest first', async () => {
    ['2024-01-01', '2024-01-03', '2024-01-02'].forEach(date => {
      fs.writeFileSync(
        path.join(storageDir, `ups-log-testups-${date}.csv`),
        'header\nrow\n'
      );
    });

    const { body } = await post(port, '/logs', { upsName: 'testups' });
    expect(body.success).toBe(true);
    expect(body.files.length).toBe(3);
    expect(body.files[0].date).toBe('2024-01-03');
    expect(body.files[2].date).toBe('2024-01-01');
  });

  // ── POST /logs/download ───────────────────────────────────────────────────

  test('POST /logs/download returns file contents', async () => {
    const content = 'timestamp,input_voltage,output_voltage,load_pct\n2024-01-01T00:00Z,230,228,10\n';
    fs.writeFileSync(
      path.join(storageDir, 'ups-log-testups-2024-01-01.csv'),
      content
    );

    const { status, body } = await post(port, '/logs/download', {
      filename: 'ups-log-testups-2024-01-01.csv',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.csv).toBe(content);
  });

  test('POST /logs/download rejects path traversal filenames', async () => {
    const { body } = await post(port, '/logs/download', {
      filename: '../../../etc/passwd',
    });
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid/i);
  });

  test('POST /logs/download returns error for missing filename param', async () => {
    const { body } = await post(port, '/logs/download', {});
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/filename/i);
  });

  test('POST /logs/download returns error for non-existent file', async () => {
    const { body } = await post(port, '/logs/download', {
      filename: 'ups-log-testups-2099-12-31.csv',
    });
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });
});
