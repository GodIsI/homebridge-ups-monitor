# Feature Roadmap — homebridge-ups-monitor

Features are tackled independently, each on its own `agent/<slug>` branch from `develop`.
See [AGENTS.md](AGENTS.md) for branch / PR conventions.

---

## Feature 1 — HomeKit Tiles ✅ `agent/homekit-tiles`

**Goal:** Surface key UPS metrics as native HomeKit tiles that appear on the Home dashboard and can trigger automations.

| Tile | HAP Service | Source variable | Notes |
|---|---|---|---|
| On Battery | `OccupancySensor` | `ups.status` → `flags.onBattery` | Triggers automations on power failure |
| Load % | `Lightbulb` (Brightness) | `ups.load` | 0–100 %, On = load > 0 |
| Input Voltage | `LightSensor` (subtype `input-voltage`) | `input.voltage` | lux range covers any AC voltage |
| Output Voltage | `LightSensor` (subtype `output-voltage`) | `output.voltage` | lux range covers any AC voltage |
| Runtime | `TemperatureSensor` | `battery.runtime ÷ 60` | Minutes; home UPS runtime fits 0–100°C |

**Why LightSensor for voltage?** `CurrentTemperature` caps at 100°C — EU 230 V exceeds that.
`CurrentAmbientLightLevel` (0.0001–100000 lux) covers any realistic AC voltage.

**Implementation:** `lib/tiles/` — one module per tile, each exporting `setup(accessory, api, upsName, opts) → { update(data, flags) }`.

---

## Feature 2 — 24h Ring-Buffer History ✅ `agent/ring-buffer-history`

**Goal:** Persist 1440 data points (one per minute) for the last 24 hours so the dashboard can render full-day charts.

**Design:**
- Server-side ring buffer in `homebridge-ui/server.js`, backed by a JSON file on disk (`~/.homebridge/ups-history-<upsName>.json`)
- New UI endpoint: `POST /history` → returns `{ timestamps[], series: { voltage, battery, load, runtime }[] }`
- The poll loop in `index.js` emits data to the ring buffer after each successful NUT query
- Dashboard `index.html` switches from the current 20-minute in-memory array to the persistent `/history` feed

**Depends on:** Feature 1 (tile refactor establishes clean data-flow pattern)

---

## Feature 3 — Log Export ✅ `agent/log-export`

**Goal:** One-click CSV download of the 24h history data from the dashboard panel, plus access to 30-day daily log files.

**Delivered:**
- `POST /export` → 24h ring-buffer as CSV (timestamp, input_voltage, output_voltage, battery_pct, load_pct, runtime_min)
- `POST /logs` → lists available 30-day daily log files for a UPS, newest first
- `POST /logs/download` → serves a single daily CSV; filename validated against strict regex to prevent path traversal
- Dashboard **Data Export** panel: Export 24h CSV button + 30-day log file table with per-row download buttons
- 15 new tests; 152 total passing

**Depends on:** Feature 2 (ring-buffer history + DailyLog)

---

## Feature 4 — Export & Share `agent/export-share`

**Goal:** Replace the current Data Export panel with a clean two-button share flow that feels native on any device (Mac, iPhone, iPad, Android).

**What changes:**
- Remove the per-day file table and the separate 24h / per-day download buttons
- Replace with two clearly-labelled actions: **Last 24 Hours** and **Last 30 Days**
- **Last 24 Hours** — existing ring buffer as CSV (unchanged data source)
- **Last 30 Days** — server aggregates all `ups-log-<upsName>-YYYY-MM-DD.csv` files into a single CSV, newest-first, on demand
- Both actions use the **Web Share API** (`navigator.share({ files: [...] })`) where supported — gives the native share sheet on Mac, iOS, and Android
- Falls back to a Blob URL download on browsers that don't support Web Share API (e.g. Firefox desktop)

**Server changes:**
- New `POST /export-30d` endpoint — reads all daily log files, concatenates (single header row, all data rows), returns CSV string + suggested filename
- Existing `POST /export` (24h) unchanged

**Dashboard changes:**
- Replace `.export-section` HTML with a simpler two-card layout
- Feature-detect `navigator.canShare` at runtime; use share flow or download fallback accordingly

**Depends on:** Feature 3 (ring buffer + DailyLog already writing the source files)

---

## Feature 5 — Standalone Dashboard Server `agent/standalone-dashboard`

**Goal:** Host the UPS dashboard as a local website on the Raspberry Pi so any browser on the network can reach it directly — no Homebridge UI, no plugin config panel required.

**Config option:** `standalonePort` (integer 1–65535, optional). Leave blank to disable.

**Access URLs:**
- `http://localhost:PORT`
- `http://homebridge.local:PORT`
- `http://<pi-ip>:PORT`

**Implementation:**
- `lib/dashboardServer.js` — new `DashboardServer` class (Node.js built-in `http` module, no extra dependencies). Serves `homebridge-ui/public/index.html` on `GET /` and exposes all API endpoints (`/ups-status`, `/history`, `/export`, `/export-30d`, `/logs`, `/logs/download`) as `POST` routes with CORS headers.
- `index.js` — wires `DashboardServer` into the platform constructor; starts on `standalonePort` if configured.
- `homebridge-ui/public/index.html` — `apiRequest()` dual-mode wrapper: uses `homebridge.request()` when embedded in the Homebridge UI, plain `fetch()` when running standalone.
- `config.schema.json` — `standalonePort` field + *Standalone Dashboard* fieldset in layout.
- `test/dashboardServer.test.js` — 20 integration tests; 176 total passing.

**Depends on:** Feature 4 (export endpoints already implemented)
