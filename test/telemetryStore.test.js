'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const store = require('../lib/telemetryStore');
const RingBuffer = require('../lib/ringBuffer');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tstore-'));
}

function seedRing(dir, upsName, points) {
  const buf = new RingBuffer(path.join(dir, `ups-history-${upsName}.json`), 1440);
  points.forEach(p => buf.push(p));
}

function writeLog(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

function writeOutageLog(dir, upsName, events) {
  fs.writeFileSync(
    path.join(dir, `ups-outages-${upsName}.json`),
    JSON.stringify({ v: 1, events }),
    'utf8',
  );
}

describe('telemetryStore.readHistory', () => {
  test('returns ring-buffer points oldest -> newest', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 100, load: 10, runtime: 1200 },
      { t: '2024-01-01T00:00:30.000Z', inV: 231, outV: 230, bat: 99,  load: 11, runtime: 1100 },
    ]);
    const pts = store.readHistory(dir, 'ups');
    expect(pts).toHaveLength(2);
    expect(pts[0].inV).toBe(230);
    expect(pts[1].bat).toBe(99);
    fs.rmSync(dir, { recursive: true });
  });

  test('returns [] when no history file exists', () => {
    const dir = tmpDir();
    expect(store.readHistory(dir, 'ups')).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('telemetryStore.lastKnownGood', () => {
  test('returns the newest point when it carries a usable reading', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 100, load: 10, runtime: 1200 },
      { t: '2024-01-01T00:00:30.000Z', inV: 231, outV: 230, bat: 99,  load: 11, runtime: 1100 },
    ]);
    const point = store.lastKnownGood(dir, 'ups');
    expect(point).toMatchObject({ t: '2024-01-01T00:00:30.000Z', bat: 99 });
    fs.rmSync(dir, { recursive: true });
  });

  test('skips a trailing all-null legacy point (written before the failed-poll telemetry-integrity fix) and returns the last usable one', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 100, load: 10, runtime: 1200 },
      { t: '2024-01-01T00:00:30.000Z', inV: 231, outV: 230, bat: 99,  load: 11, runtime: 1100 },
      // Pre-#238 behaviour could push a timestamp-only point on a failed poll.
      { t: '2024-01-01T00:01:00.000Z', inV: null, outV: null, bat: null, load: null, runtime: null },
    ]);
    const point = store.lastKnownGood(dir, 'ups');
    expect(point).toMatchObject({ t: '2024-01-01T00:00:30.000Z', bat: 99 });
    fs.rmSync(dir, { recursive: true });
  });

  test('skips multiple trailing all-null points, not just one', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 100, load: 10, runtime: 1200 },
      { t: '2024-01-01T00:00:30.000Z', inV: null, outV: null, bat: null, load: null, runtime: null },
      { t: '2024-01-01T00:01:00.000Z', inV: null, outV: null, bat: null, load: null, runtime: null },
    ]);
    const point = store.lastKnownGood(dir, 'ups');
    expect(point).toMatchObject({ t: '2024-01-01T00:00:00.000Z', bat: 100 });
    fs.rmSync(dir, { recursive: true });
  });

  test('returns null when every persisted point is all-null', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: null, outV: null, bat: null, load: null, runtime: null },
    ]);
    expect(store.lastKnownGood(dir, 'ups')).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  test('returns null when no history file exists', () => {
    const dir = tmpDir();
    expect(store.lastKnownGood(dir, 'ups')).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
});

describe('telemetryStore.hasUsableMetric', () => {
  test('true when at least one metric is a number, including 0', () => {
    expect(store.hasUsableMetric({ inV: null, outV: null, bat: 0, load: null, runtime: null })).toBe(true);
  });

  test('false for a timestamp-only point', () => {
    expect(store.hasUsableMetric({ t: '2024-01-01T00:00:00.000Z' })).toBe(false);
  });

  test('false for null/undefined input', () => {
    expect(store.hasUsableMetric(null)).toBe(false);
    expect(store.hasUsableMetric(undefined)).toBe(false);
  });
});

describe('telemetryStore.buildHistoryCsv', () => {
  test('emits the unified header and converts runtime to minutes', () => {
    const dir = tmpDir();
    seedRing(dir, 'ups', [
      { t: '2024-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 100, load: 10, runtime: 1110 },
    ]);
    const { filename, csv } = store.buildHistoryCsv(dir, 'ups');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
    expect(lines[1]).toBe('2024-01-01T00:00:00.000Z,230,229,100,10,18.50');
    expect(filename).toMatch(/^ups-ups-\d{4}-\d{2}-\d{2}\.csv$/);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('telemetryStore.build30dCsv', () => {
  test('header-only CSV when no daily logs exist', () => {
    const dir = tmpDir();
    const { csv } = store.build30dCsv(dir, 'ups');
    expect(csv.trim()).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
    fs.rmSync(dir, { recursive: true });
  });

  test('remaps old 4-column and new 6-column files into the unified schema', () => {
    const dir = tmpDir();
    writeLog(dir, 'ups-log-ups-2024-01-01.csv',
      'timestamp,input_voltage,output_voltage,load_pct\n2024-01-01T00:00:00.000Z,230,228,10\n');
    writeLog(dir, 'ups-log-ups-2024-01-02.csv',
      'timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min\n2024-01-02T00:00:00.000Z,229,227,95,12,18.50\n');
    const { csv } = store.build30dCsv(dir, 'ups');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,battery_pct,load_pct,runtime_min');
    expect(lines).toContain('2024-01-01T00:00:00.000Z,230,228,,10,');
    expect(lines).toContain('2024-01-02T00:00:00.000Z,229,227,95,12,18.50');
    fs.rmSync(dir, { recursive: true });
  });
});

describe('telemetryStore.buildOutageCsv', () => {
  test('header-only CSV when no outages exist', () => {
    const dir = tmpDir();
    const { filename, csv } = store.buildOutageCsv(dir, 'ups');
    expect(csv.trim()).toBe('ups_name,start,end,duration_sec,ongoing,acknowledged,acknowledged_at,start_battery_pct,end_battery_pct,lowest_battery_pct,low_battery');
    expect(filename).toMatch(/^ups-ups-outages-\d{4}-\d{2}-\d{2}\.csv$/);
    fs.rmSync(dir, { recursive: true });
  });

  test('exports completed, acknowledged, and ongoing outage events newest first', () => {
    const dir = tmpDir();
    writeOutageLog(dir, 'ups', [
      {
        id: '2026-06-05T01:00:00.000Z',
        upsName: 'ups',
        start: '2026-06-05T01:00:00.000Z',
        end: '2026-06-05T01:05:30.000Z',
        durationSec: 330,
        ongoing: false,
        acknowledged: true,
        acknowledgedAt: '2026-06-05T01:06:00.000Z',
        startBattery: 92,
        endBattery: 84,
        lowestBattery: 84,
        lowBattery: false,
      },
      {
        id: '2026-06-05T02:00:00.000Z',
        upsName: 'ups',
        start: '2026-06-05T02:00:00.000Z',
        end: null,
        durationSec: null,
        ongoing: true,
        acknowledged: false,
        acknowledgedAt: null,
        startBattery: 72,
        endBattery: null,
        lowestBattery: 68,
        lowBattery: true,
      },
    ]);

    const { csv } = store.buildOutageCsv(dir, 'ups');
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('ups_name,start,end,duration_sec,ongoing,acknowledged,acknowledged_at,start_battery_pct,end_battery_pct,lowest_battery_pct,low_battery');
    expect(lines[1]).toBe('ups,2026-06-05T02:00:00.000Z,,,true,false,,72,,68,true');
    expect(lines[2]).toBe('ups,2026-06-05T01:00:00.000Z,2026-06-05T01:05:30.000Z,330,false,true,2026-06-05T01:06:00.000Z,92,84,84,false');

    fs.rmSync(dir, { recursive: true });
  });

  test('escapes CSV values when needed', () => {
    const dir = tmpDir();
    writeOutageLog(dir, 'office,ups', [{
      id: '2026-06-05T01:00:00.000Z',
      upsName: 'office,ups',
      start: '2026-06-05T01:00:00.000Z',
      end: null,
      durationSec: null,
      ongoing: true,
      acknowledged: false,
      acknowledgedAt: null,
      startBattery: null,
      endBattery: null,
      lowestBattery: null,
      lowBattery: false,
    }]);

    const { csv } = store.buildOutageCsv(dir, 'office,ups');
    expect(csv.trim().split('\n')[1]).toBe('"office,ups",2026-06-05T01:00:00.000Z,,,true,false,,,,,false');

    fs.rmSync(dir, { recursive: true });
  });
});

describe('telemetryStore.listLogs', () => {
  test('lists matching files newest first and ignores other UPS files', () => {
    const dir = tmpDir();
    ['2024-01-01', '2024-01-03', '2024-01-02'].forEach(d =>
      writeLog(dir, `ups-log-ups-${d}.csv`, 'header\nrow\n'));
    writeLog(dir, 'ups-log-other-2024-01-01.csv', 'header\nrow\n');
    const files = store.listLogs(dir, 'ups');
    expect(files.map(f => f.date)).toEqual(['2024-01-03', '2024-01-02', '2024-01-01']);
    expect(files[0]).toHaveProperty('sizeBytes');
    fs.rmSync(dir, { recursive: true });
  });

  test('returns [] when the directory does not exist', () => {
    expect(store.listLogs(path.join(os.tmpdir(), 'does-not-exist-xyz'), 'ups')).toEqual([]);
  });
});

describe('telemetryStore.readLogFile', () => {
  test('returns csv for a valid filename', () => {
    const dir = tmpDir();
    writeLog(dir, 'ups-log-ups-2024-01-01.csv', 'timestamp,input_voltage\n2024-01-01T00:00Z,230\n');
    const r = store.readLogFile(dir, 'ups-log-ups-2024-01-01.csv');
    expect(r.success).toBe(true);
    expect(r.csv).toContain('timestamp,input_voltage');
    fs.rmSync(dir, { recursive: true });
  });

  test('rejects a missing filename', () => {
    expect(store.readLogFile(tmpDir(), '')).toEqual({ success: false, error: 'filename is required' });
  });

  test('rejects a traversal / invalid filename', () => {
    expect(store.readLogFile(tmpDir(), '../../etc/passwd'))
      .toEqual({ success: false, error: 'Invalid filename' });
  });

  test('reports a not-found file', () => {
    const dir = tmpDir();
    expect(store.readLogFile(dir, 'ups-log-ups-2024-12-31.csv'))
      .toEqual({ success: false, error: 'File not found' });
    fs.rmSync(dir, { recursive: true });
  });
});
