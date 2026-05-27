'use strict';

/**
 * lib/dailyLog.js
 *
 * Appends UPS telemetry to per-day CSV files and prunes files older than
 * `retainDays` (default 30) so disk usage stays bounded.
 *
 * One CSV file per UPS per calendar day:
 *   <storageDir>/ups-log-<upsName>-YYYY-MM-DD.csv
 *
 * CSV format:
 *   timestamp,input_voltage,output_voltage,load_pct
 *   2024-06-01T00:01:05.123Z,230.5,229.8,22
 *   ...
 *
 * Usage:
 *   const DailyLog = require('./lib/dailyLog');
 *   const log = new DailyLog('/var/lib/homebridge', 'ups', 30);
 *   log.append({ t: new Date().toISOString(), inV: 230.5, outV: 229.8, load: 22 });
 *
 * Notes:
 *   • append() uses fs.appendFileSync — no read-modify-write overhead.
 *   • The header line is written once when a new file is created.
 *   • Pruning runs in the constructor; it is best-effort (errors are silenced).
 *   • The class is intentionally synchronous so it is trivially safe to call
 *     from inside an async poll loop without needing await.
 */

const fs   = require('fs');
const path = require('path');

const CSV_HEADER = 'timestamp,input_voltage,output_voltage,load_pct\n';

class DailyLog {
  /**
   * @param {string} storageDir  Directory where CSV files are written
   * @param {string} upsName     UPS identifier (used in the filename)
   * @param {number} [retainDays=30]  Number of days of logs to keep
   */
  constructor(storageDir, upsName, retainDays = 30) {
    this.storageDir  = storageDir;
    this.upsName     = upsName;
    this.retainDays  = retainDays;

    this._ensureDir();
    this._prune();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Append one telemetry row to today's CSV file.
   *
   * @param {{ t: string, inV: number|null, outV: number|null, load: number|null }} point
   */
  append({ t, inV, outV, load }) {
    const filePath = this._fileForDate(this._dateStr(new Date()));
    const isNew    = !fs.existsSync(filePath);

    const line = `${t ?? ''},${inV ?? ''},${outV ?? ''},${load ?? ''}\n`;
    try {
      if (isNew) {
        fs.writeFileSync(filePath, CSV_HEADER + line, 'utf8');
      } else {
        fs.appendFileSync(filePath, line, 'utf8');
      }
    } catch {
      // Non-fatal — history poll continues even if disk write fails
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Produce "YYYY-MM-DD" from a Date object (UTC). */
  _dateStr(date) {
    return date.toISOString().slice(0, 10);
  }

  /** Absolute path for a given date string. */
  _fileForDate(dateStr) {
    return path.join(this.storageDir, `ups-log-${this.upsName}-${dateStr}.csv`);
  }

  /** Create the storage directory if it does not exist. */
  _ensureDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Delete CSV files for this UPS that are older than retainDays.
   * Silently ignores any errors.
   */
  _prune() {
    try {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - this.retainDays);

      const prefix = `ups-log-${this.upsName}-`;
      const files  = fs.readdirSync(this.storageDir).filter(f =>
        f.startsWith(prefix) && f.endsWith('.csv')
      );

      for (const file of files) {
        // Extract "YYYY-MM-DD" from "ups-log-<upsName>-YYYY-MM-DD.csv"
        const dateStr = file.slice(prefix.length, -4);  // strip prefix and ".csv"
        const fileDate = new Date(dateStr + 'T00:00:00.000Z');
        if (!isNaN(fileDate.getTime()) && fileDate < cutoff) {
          try { fs.unlinkSync(path.join(this.storageDir, file)); } catch {}
        }
      }
    } catch {
      // Best-effort
    }
  }
}

module.exports = DailyLog;
