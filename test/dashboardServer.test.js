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

  test('a post-startup server error is logged, not thrown', () => {
    // Simulate a runtime server error after a successful listen.
    expect(() => server._server.emit('error', new Error('boom'))).not.toThrow();
    expect(server.log ? server.log.error : true).toBeTruthy();
    expect(server._log.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  test('GET / returns 200 with HTML content-type', async () => {
    const { status, body } = await get(port, '/');
    expect(status).toBe(200);
    expect(body).toMatch(/<html/i);
  });

  test('GET /vendor/chart.umd.min.js serves the vendored Chart.js bundle', async () => {
    const { status, body } = await get(port, '/vendor/chart.umd.min.js');
    expect(status).toBe(200);
    expect(body).toMatch(/Chart\.js v4/);
  });

  test('GET /icons/icon.svg serves the dashboard icon', async () => {
    const { status, body } = await get(port, '/icons/icon.svg');
    expect(status).toBe(200);
    expect(body).toMatch(/<svg/i);
  });

  test('GET /manifest.webmanifest serves the web app manifest', async () => {
    const { status, body } = await get(port, '/manifest.webmanifest');
    expect(status).toBe(200);
    expect(body).toMatch(/"icons"/);
  });

  // ── Unknown routes ─────────────────────────────────────────────────────────

  test('POST /unknown returns 404', async () => {
    const { status, body } = await post(port, '/no-such-endpoint');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  // Telemetry routes are looked up in a Map, so a request path that names an
  // inherited Object.prototype member must not dispatch to it (CodeQL: no
  // unvalidated dynamic method call).
  test.each(['/hasOwnProperty', '/__proto__', '/constructor', '/toString'])(
    'POST %s does not dispatch to an inherited member (returns 404)',
    async (urlPath) => {
      const { status, body } = await post(port, urlPath);
      expect(status).toBe(404);
      expect(body.success).toBe(false);
    },
  );

  // ── POST /ups-status ──────────────────────────────────────────────────────

  test('POST /ups-status returns success with data array', async () => {
    const { status, body } = await post(port, '/ups-status');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]._upsName).toBe('testups');
  });

  describe('POST /ups-status — NUT protocol error handling (issue #237)', () => {
    test('a NUTQueryError-shaped rejection is surfaced with code/category/retryable/guidance', async () => {
      const { queryNUT } = require('../lib/nutClient');
      queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
        code: 'DATA-STALE', category: 'stale-data', retryable: true,
        guidance: 'Check the driver status and USB connectivity.',
      }));

      const { status, body } = await post(port, '/ups-status');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      const [entry] = body.data;
      expect(entry._upsName).toBe('testups');
      expect(entry._error).toBe('DATA-STALE');
      expect(entry._errorCode).toBe('DATA-STALE');
      expect(entry._errorCategory).toBe('stale-data');
      expect(entry._retryable).toBe(true);
      expect(entry._guidance).toBe('Check the driver status and USB connectivity.');
    });

    test('a plain Error rejection (e.g. connection refused) still surfaces _error with null structured fields', async () => {
      const { queryNUT } = require('../lib/nutClient');
      queryNUT.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const { body } = await post(port, '/ups-status');
      const [entry] = body.data;
      expect(entry._error).toBe('connect ECONNREFUSED');
      expect(entry._errorCode).toBeNull();
      expect(entry._errorCategory).toBeNull();
      expect(entry._retryable).toBeNull();
      expect(entry._guidance).toBeNull();
    });

    test('_lastKnownGood carries the most recent persisted telemetry point when a query fails', async () => {
      // Seed history as if an earlier successful poll had already run.
      const histFile = path.join(storageDir, 'ups-history-testups.json');
      const buf = new RingBuffer(histFile, 100);
      buf.push({ t: '2026-01-01T00:00:00.000Z', inV: 229, outV: 229, bat: 90, load: 30, runtime: 5000 });
      buf.push({ t: '2026-01-01T00:01:00.000Z', inV: 230, outV: 230, bat: 88, load: 32, runtime: 4900 });

      const { queryNUT } = require('../lib/nutClient');
      queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
        code: 'DATA-STALE', category: 'stale-data', retryable: true,
      }));

      const { body } = await post(port, '/ups-status');
      const [entry] = body.data;
      expect(entry._lastKnownGood).toMatchObject({ t: '2026-01-01T00:01:00.000Z', bat: 88, load: 32 });
    });

    test('_lastKnownGood is null when no history has been recorded yet', async () => {
      const { queryNUT } = require('../lib/nutClient');
      queryNUT.mockRejectedValueOnce(Object.assign(new Error('UNKNOWN-UPS'), {
        code: 'UNKNOWN-UPS', category: 'unknown-ups', retryable: false,
      }));

      const { body } = await post(port, '/ups-status');
      expect(body.data[0]._lastKnownGood).toBeNull();
    });

    test('a successful query is unaffected — no error fields are present', async () => {
      const { body } = await post(port, '/ups-status');
      const [entry] = body.data;
      expect(entry._error).toBeUndefined();
      expect(entry._lastKnownGood).toBeUndefined();
    });
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
    expect(body.csv).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
  });

  test('POST /export-30d aggregates daily log files into the unified schema', async () => {
    // Old-format file (4 columns, no battery/runtime) — must still remap.
    fs.writeFileSync(
      path.join(storageDir, 'ups-log-testups-2024-01-01.csv'),
      'timestamp,input_voltage,output_voltage,load_pct\n' +
      '2024-01-01T00:00:00.000Z,230,228,10\n'
    );
    // New-format file (6 columns).
    fs.writeFileSync(
      path.join(storageDir, 'ups-log-testups-2024-01-02.csv'),
      'timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min\n' +
      '2024-01-02T00:00:00.000Z,229,227,95,12,18.50\n'
    );

    const { body } = await post(port, '/export-30d', { upsName: 'testups' });
    expect(body.success).toBe(true);
    const lines = body.csv.trim().split('\n');
    expect(lines.length).toBe(3);  // header + 2 data rows
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
    // Old file: load stays in the load_pct column; battery_pct + runtime_min blank.
    expect(lines).toContain('2024-01-01T00:00:00.000Z,230,228,,10,');
    // New file: all columns carried through.
    expect(lines).toContain('2024-01-02T00:00:00.000Z,229,227,95,12,18.50');
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

  // ── POST /outages ─────────────────────────────────────────────────────────

  test('POST /outages returns latest outage and timeline events', async () => {
    fs.writeFileSync(
      path.join(storageDir, 'ups-outages-testups.json'),
      JSON.stringify({
        v: 1,
        events: [{
          id: '2026-06-05T01:00:00.000Z',
          upsName: 'testups',
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
        }],
      }),
      'utf8'
    );

    const { status, body } = await post(port, '/outages', { upsName: 'testups' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.upsName).toBe('testups');
    expect(body.latest.durationSec).toBe(300);
    expect(body.events).toHaveLength(1);
  });

  test('POST /outages/acknowledge marks the latest outage as acknowledged', async () => {
    fs.writeFileSync(
      path.join(storageDir, 'ups-outages-testups.json'),
      JSON.stringify({
        v: 1,
        events: [{
          id: '2026-06-05T01:00:00.000Z',
          upsName: 'testups',
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
        }],
      }),
      'utf8'
    );

    const { body } = await post(port, '/outages/acknowledge', { upsName: 'testups' });

    expect(body.success).toBe(true);
    expect(body.acknowledged).toBe(true);
    expect(body.latest.acknowledged).toBe(true);
    expect(body.events).toHaveLength(1);
  });

  test('POST /outages/clear removes outage events only', async () => {
    fs.writeFileSync(
      path.join(storageDir, 'ups-outages-testups.json'),
      JSON.stringify({
        v: 1,
        events: [{
          id: '2026-06-05T01:00:00.000Z',
          upsName: 'testups',
          start: '2026-06-05T01:00:00.000Z',
          end: null,
          durationSec: null,
          ongoing: true,
          acknowledged: false,
          acknowledgedAt: null,
        }],
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(storageDir, 'ups-log-testups-2026-06-05.csv'), 'header\nrow\n', 'utf8');

    const { body } = await post(port, '/outages/clear', { upsName: 'testups' });

    expect(body.success).toBe(true);
    expect(body.cleared).toBe(1);
    expect(body.events).toEqual([]);
    expect(fs.existsSync(path.join(storageDir, 'ups-log-testups-2026-06-05.csv'))).toBe(true);
  });

  test('POST /outages/export returns outage timeline CSV', async () => {
    fs.writeFileSync(
      path.join(storageDir, 'ups-outages-testups.json'),
      JSON.stringify({
        v: 1,
        events: [{
          id: '2026-06-05T01:00:00.000Z',
          upsName: 'testups',
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
        }],
      }),
      'utf8'
    );

    const { status, body } = await post(port, '/outages/export', { upsName: 'testups' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.upsName).toBe('testups');
    expect(body.filename).toMatch(/^ups-testups-outages-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(body.csv).toContain('ups_name,start,end,duration_sec');
    expect(body.csv).toContain('testups,2026-06-05T01:00:00.000Z,2026-06-05T01:05:00.000Z,300,false,true');
  });
});
