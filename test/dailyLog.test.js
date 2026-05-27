'use strict';

/**
 * test/dailyLog.test.js
 *
 * Unit tests for lib/dailyLog.js.
 * Uses real temp directories so the file-write path is fully exercised.
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const DailyLog = require('../lib/dailyLog');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daily-log-test-'));
}

/** Return today's UTC date string "YYYY-MM-DD". */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Build an ISO timestamp for a given "YYYY-MM-DD" date. */
function tsForDate(dateStr) {
  return `${dateStr}T12:00:00.000Z`;
}

function makePoint(dateStr, inV = 230, outV = 229, load = 20) {
  return { t: tsForDate(dateStr), inV, outV, load };
}

// ── Construction ──────────────────────────────────────────────────────────────

describe('DailyLog — construction', () => {
  test('creates the storage directory if it does not exist', () => {
    const dir = path.join(os.tmpdir(), `new-dir-${Date.now()}`);
    expect(fs.existsSync(dir)).toBe(false);
    new DailyLog(dir, 'ups');
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  test('does not throw when directory already exists', () => {
    const dir = tmpDir();
    expect(() => new DailyLog(dir, 'ups')).not.toThrow();
    fs.rmSync(dir, { recursive: true });
  });
});

// ── append ────────────────────────────────────────────────────────────────────

describe('DailyLog — append', () => {
  test('creates today\'s file with header on first append', () => {
    const dir = tmpDir();
    const log = new DailyLog(dir, 'ups');
    log.append(makePoint(todayStr()));

    const file = path.join(dir, `ups-log-ups-${todayStr()}.csv`);
    expect(fs.existsSync(file)).toBe(true);

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,load_pct');
    expect(lines).toHaveLength(2);

    fs.rmSync(dir, { recursive: true });
  });

  test('appends to an existing file without duplicating the header', () => {
    const dir = tmpDir();
    const log = new DailyLog(dir, 'ups');
    log.append(makePoint(todayStr(), 230, 229, 20));
    log.append(makePoint(todayStr(), 231, 230, 21));
    log.append(makePoint(todayStr(), 232, 231, 22));

    const file  = path.join(dir, `ups-log-ups-${todayStr()}.csv`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('timestamp,input_voltage,output_voltage,load_pct');

    fs.rmSync(dir, { recursive: true });
  });

  test('data row contains correct fields in correct order', () => {
    const dir = tmpDir();
    const log = new DailyLog(dir, 'ups');
    const ts  = `${todayStr()}T08:30:00.000Z`;
    log.append({ t: ts, inV: 230.5, outV: 229.3, load: 18 });

    const file  = path.join(dir, `ups-log-ups-${todayStr()}.csv`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[1]).toBe(`${ts},230.5,229.3,18`);

    fs.rmSync(dir, { recursive: true });
  });

  test('null values are written as empty fields', () => {
    const dir = tmpDir();
    const log = new DailyLog(dir, 'ups');
    log.append({ t: `${todayStr()}T00:00:00.000Z`, inV: null, outV: null, load: null });

    const file  = path.join(dir, `ups-log-ups-${todayStr()}.csv`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines[1]).toBe(`${todayStr()}T00:00:00.000Z,,,`);

    fs.rmSync(dir, { recursive: true });
  });

  test('uses the upsName in the filename', () => {
    const dir = tmpDir();
    const log = new DailyLog(dir, 'cyberpower-900');
    log.append(makePoint(todayStr()));

    const file = path.join(dir, `ups-log-cyberpower-900-${todayStr()}.csv`);
    expect(fs.existsSync(file)).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── Pruning ───────────────────────────────────────────────────────────────────

describe('DailyLog — pruning', () => {
  test('removes files older than retainDays on construction', () => {
    const dir = tmpDir();

    // Create a file dated 31 days ago (should be pruned with retainDays=30)
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 31);
    const oldDate = old.toISOString().slice(0, 10);
    const oldFile = path.join(dir, `ups-log-ups-${oldDate}.csv`);
    fs.writeFileSync(oldFile, 'stale data', 'utf8');

    expect(fs.existsSync(oldFile)).toBe(true);
    new DailyLog(dir, 'ups', 30);
    expect(fs.existsSync(oldFile)).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });

  test('keeps files within retainDays', () => {
    const dir = tmpDir();

    // Create a file dated 29 days ago (should be kept with retainDays=30)
    const recent = new Date();
    recent.setUTCDate(recent.getUTCDate() - 29);
    const recentDate = recent.toISOString().slice(0, 10);
    const recentFile = path.join(dir, `ups-log-ups-${recentDate}.csv`);
    fs.writeFileSync(recentFile, CSV_HEADER(), 'utf8');

    new DailyLog(dir, 'ups', 30);
    expect(fs.existsSync(recentFile)).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  test('does not prune files belonging to a different UPS', () => {
    const dir = tmpDir();

    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 31);
    const oldDate = old.toISOString().slice(0, 10);
    // File for a different UPS — should NOT be pruned when constructing for 'ups'
    const otherFile = path.join(dir, `ups-log-other-${oldDate}.csv`);
    fs.writeFileSync(otherFile, 'other ups data', 'utf8');

    new DailyLog(dir, 'ups', 30);
    expect(fs.existsSync(otherFile)).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  test('prunes exactly at the boundary (retainDays old = pruned)', () => {
    const dir = tmpDir();

    // retainDays = 5; a file exactly 5 days old sits on the boundary → should be pruned
    const boundary = new Date();
    boundary.setUTCDate(boundary.getUTCDate() - 5);
    const bDate = boundary.toISOString().slice(0, 10);
    const bFile = path.join(dir, `ups-log-ups-${bDate}.csv`);
    fs.writeFileSync(bFile, CSV_HEADER(), 'utf8');

    new DailyLog(dir, 'ups', 5);
    expect(fs.existsSync(bFile)).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('DailyLog — resilience', () => {
  test('continues working after append even if storageDir is nested and new', () => {
    const dir = path.join(os.tmpdir(), `nested-${Date.now()}`, 'sub', 'dir');
    const log = new DailyLog(dir, 'ups');
    expect(() => log.append(makePoint(todayStr()))).not.toThrow();
    expect(log).toBeDefined();
    fs.rmSync(path.join(os.tmpdir(), `nested-${Date.now() - 1}`), { recursive: true, force: true });
  });
});

// ── Helpers local to test file ────────────────────────────────────────────────
function CSV_HEADER() { return 'timestamp,input_voltage,output_voltage,load_pct\n'; }
