'use strict';

/**
 * lib/ringBuffer.js
 *
 * A simple file-backed ring buffer for UPS telemetry history.
 *
 * Each UPS gets its own JSON file:
 *   <storagePath>/ups-history-<upsName>.json
 *
 * The file is written by the Homebridge poll loop (index.js) and read by
 * the UI server (homebridge-ui/server.js).  Both processes resolve the same
 * storage path, so they naturally share the file without any IPC.
 *
 * File format:
 *   {
 *     "v":      1,              schema version
 *     "max":    1440,           capacity
 *     "head":   0,              next write index (wraps at max)
 *     "count":  0,              how many slots are populated
 *     "points": [ ... ]         fixed-length sparse array
 *   }
 *
 * Points are stored as compact objects:
 *   { t, inV, outV, bat, load, runtime }
 *   t        — ISO 8601 timestamp string
 *   inV      — input.voltage  (number | null)
 *   outV     — output.voltage (number | null)
 *   bat      — battery.charge (number | null)
 *   load     — ups.load       (number | null)
 *   runtime  — battery.runtime in seconds (number | null)
 *
 * Usage:
 *   const RingBuffer = require('./lib/ringBuffer');
 *   const buf = new RingBuffer('/var/lib/homebridge/ups-history-ups.json', 1440);
 *   buf.push({ t: new Date().toISOString(), inV: 230.5, ... });
 *   const points = buf.read();  // ordered oldest → newest
 */

const fs   = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

class RingBuffer {
  /**
   * @param {string} filePath  Absolute path to the JSON backing file
   * @param {number} [maxPoints=1440]  Ring capacity (1 point/min × 1440 = 24 h)
   */
  constructor(filePath, maxPoints = 1440) {
    this.filePath  = filePath;
    this.maxPoints = maxPoints;
    this._state    = this._load();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Append one telemetry point and flush to disk.
   *
   * @param {{ t:string, inV:number|null, outV:number|null,
   *            bat:number|null, load:number|null, runtime:number|null }} point
   */
  push(point) {
    const s = this._state;
    s.points[s.head] = point;
    s.head  = (s.head + 1) % s.max;
    s.count = Math.min(s.count + 1, s.max);
    this._flush();
  }

  /**
   * Return all stored points in chronological order (oldest first).
   *
   * @returns {Array<object>}
   */
  read() {
    const { points, head, count, max } = this._state;
    if (count === 0) return [];

    const result = [];
    // When the buffer has wrapped, oldest entry is at `head`
    const start = count < max ? 0 : head;
    for (let i = 0; i < count; i++) {
      result.push(points[(start + i) % max]);
    }
    return result;
  }

  /**
   * Number of points currently stored.
   * @returns {number}
   */
  get size() { return this._state.count; }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Load state from disk, or return a fresh empty state. */
  _load() {
    try {
      const raw  = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);

      // Migrate or reset if schema changed or capacity was resized
      if (data.v !== SCHEMA_VERSION || data.max !== this.maxPoints) {
        return this._fresh();
      }

      // Ensure points array is exactly the right length
      if (!Array.isArray(data.points) || data.points.length !== this.maxPoints) {
        return this._fresh();
      }

      return data;
    } catch {
      // File missing, unreadable, or corrupt — start fresh
      return this._fresh();
    }
  }

  /** Return a blank state object. */
  _fresh() {
    return {
      v:      SCHEMA_VERSION,
      max:    this.maxPoints,
      head:   0,
      count:  0,
      points: new Array(this.maxPoints).fill(null),
    };
  }

  /** Write state to disk atomically (write-then-rename). */
  _flush() {
    const tmp = this.filePath + '.tmp';
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this._state), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      // Non-fatal — history is still in memory, next push will retry
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
}

module.exports = RingBuffer;
