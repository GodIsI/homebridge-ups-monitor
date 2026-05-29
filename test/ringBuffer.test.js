'use strict';

/**
 * test/ringBuffer.test.js
 *
 * Unit tests for lib/ringBuffer.js.
 * Uses a real temp directory so the file-write path is fully exercised.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const RingBuffer = require('../lib/ringBuffer');

// ── Test fixtures ─────────────────────────────────────────────────────────────

function tmpFile() {
  return path.join(os.tmpdir(), `ring-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function makePoint(n) {
  return {
    t:       new Date(Date.now() + n * 60000).toISOString(),
    inV:     230 + n,
    outV:    229 + n,
    bat:     80 + n,
    load:    20 + n,
    runtime: 3600 - n * 60,
  };
}

afterEach(() => {
  // Clean up any leftover temp files — best-effort
});

// ── Construction ──────────────────────────────────────────────────────────────

describe('RingBuffer — construction', () => {
  test('creates a new empty buffer when file does not exist', () => {
    const buf = new RingBuffer(tmpFile(), 10);
    expect(buf.size).toBe(0);
    expect(buf.read()).toEqual([]);
  });

  test('respects a custom maxPoints', () => {
    const f = tmpFile();
    const buf = new RingBuffer(f, 5);
    for (let i = 0; i < 7; i++) buf.push(makePoint(i));
    expect(buf.size).toBe(5);
  });
});

// ── push / read round-trip ────────────────────────────────────────────────────

describe('RingBuffer — push and read', () => {
  test('read returns points in insertion order', () => {
    const buf = new RingBuffer(tmpFile(), 10);
    buf.push(makePoint(0));
    buf.push(makePoint(1));
    buf.push(makePoint(2));
    const pts = buf.read();
    expect(pts).toHaveLength(3);
    expect(pts[0].inV).toBe(230);
    expect(pts[1].inV).toBe(231);
    expect(pts[2].inV).toBe(232);
  });

  test('size increments with each push', () => {
    const buf = new RingBuffer(tmpFile(), 10);
    expect(buf.size).toBe(0);
    buf.push(makePoint(0));
    expect(buf.size).toBe(1);
    buf.push(makePoint(1));
    expect(buf.size).toBe(2);
  });

  test('single push then read returns that point', () => {
    const buf = new RingBuffer(tmpFile(), 10);
    const p   = makePoint(0);
    buf.push(p);
    expect(buf.read()).toEqual([p]);
  });
});

// ── Ring wrap-around ──────────────────────────────────────────────────────────

describe('RingBuffer — wrap-around behaviour', () => {
  test('oldest points are evicted once max capacity is reached', () => {
    const buf = new RingBuffer(tmpFile(), 3);
    buf.push(makePoint(0));
    buf.push(makePoint(1));
    buf.push(makePoint(2));
    buf.push(makePoint(3));  // evicts makePoint(0)
    const pts = buf.read();
    expect(pts).toHaveLength(3);
    expect(pts[0].inV).toBe(231);  // makePoint(1)
    expect(pts[2].inV).toBe(233);  // makePoint(3)
  });

  test('size never exceeds maxPoints', () => {
    const buf = new RingBuffer(tmpFile(), 5);
    for (let i = 0; i < 20; i++) buf.push(makePoint(i));
    expect(buf.size).toBe(5);
  });

  test('read order is oldest-first after wrap', () => {
    const buf = new RingBuffer(tmpFile(), 4);
    for (let i = 0; i < 6; i++) buf.push(makePoint(i));
    // Should contain points 2, 3, 4, 5
    const pts = buf.read();
    expect(pts[0].inV).toBe(232);
    expect(pts[3].inV).toBe(235);
  });

  test('1440-point buffer: 1441 pushes leaves the correct tail', () => {
    const buf = new RingBuffer(tmpFile(), 1440);
    for (let i = 0; i < 1441; i++) buf.push(makePoint(i));
    expect(buf.size).toBe(1440);
    const pts = buf.read();
    expect(pts[0].inV).toBe(231);      // makePoint(1)
    expect(pts[1439].inV).toBe(1670);  // makePoint(1440)
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('RingBuffer — file persistence', () => {
  test('data survives creating a new instance from the same file', () => {
    const f = tmpFile();
    const buf1 = new RingBuffer(f, 10);
    buf1.push(makePoint(0));
    buf1.push(makePoint(1));

    const buf2 = new RingBuffer(f, 10);
    expect(buf2.size).toBe(2);
    expect(buf2.read()[0].inV).toBe(230);
    expect(buf2.read()[1].inV).toBe(231);
  });

  test('wrapped state is preserved across restarts', () => {
    const f = tmpFile();
    const buf1 = new RingBuffer(f, 3);
    for (let i = 0; i < 5; i++) buf1.push(makePoint(i));

    const buf2 = new RingBuffer(f, 3);
    expect(buf2.size).toBe(3);
    const pts = buf2.read();
    expect(pts[0].inV).toBe(232);
    expect(pts[2].inV).toBe(234);
  });

  test('writes a valid JSON file to disk', () => {
    const f = tmpFile();
    const buf = new RingBuffer(f, 5);
    buf.push(makePoint(0));
    const raw  = fs.readFileSync(f, 'utf8');
    const data = JSON.parse(raw);
    expect(data.v).toBe(1);
    expect(data.max).toBe(5);
    expect(data.count).toBe(1);
    expect(Array.isArray(data.points)).toBe(true);
    expect(data.points).toHaveLength(5);
  });

  test('resets cleanly when the persisted file has a different maxPoints', () => {
    const f = tmpFile();
    const buf1 = new RingBuffer(f, 5);
    buf1.push(makePoint(0));

    // Re-open with a different capacity — should start fresh
    const buf2 = new RingBuffer(f, 10);
    expect(buf2.size).toBe(0);
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('RingBuffer — resilience', () => {
  test('starts fresh when file contains invalid JSON', () => {
    const f = tmpFile();
    fs.writeFileSync(f, 'not valid json at all!!!', 'utf8');
    const buf = new RingBuffer(f, 10);
    expect(buf.size).toBe(0);
  });

  test('starts fresh when file is empty', () => {
    const f = tmpFile();
    fs.writeFileSync(f, '', 'utf8');
    const buf = new RingBuffer(f, 10);
    expect(buf.size).toBe(0);
  });

  test('starts fresh when points array length is wrong', () => {
    const f = tmpFile();
    fs.writeFileSync(f, JSON.stringify({ v: 1, max: 10, head: 0, count: 2, points: [null, null] }), 'utf8');
    const buf = new RingBuffer(f, 10);
    expect(buf.size).toBe(0);
  });

  test('continues working after a push even if the file did not exist', () => {
    const f = path.join(os.tmpdir(), `no-dir-${Date.now()}`, 'history.json');
    const buf = new RingBuffer(f, 5);
    buf.push(makePoint(0));
    expect(buf.size).toBe(1);
  });
});
