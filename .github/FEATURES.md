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

## Feature 2 — 24h Ring-Buffer History `agent/ring-buffer-history`

**Goal:** Persist 1440 data points (one per minute) for the last 24 hours so the dashboard can render full-day charts.

**Design:**
- Server-side ring buffer in `homebridge-ui/server.js`, backed by a JSON file on disk (`~/.homebridge/ups-history-<upsName>.json`)
- New UI endpoint: `POST /history` → returns `{ timestamps[], series: { voltage, battery, load, runtime }[] }`
- The poll loop in `index.js` emits data to the ring buffer after each successful NUT query
- Dashboard `index.html` switches from the current 20-minute in-memory array to the persistent `/history` feed

**Depends on:** Feature 1 (tile refactor establishes clean data-flow pattern)

---

## Feature 3 — Log Export `agent/log-export`

**Goal:** One-click CSV download of the 24h history data from the dashboard panel.

**Design:**
- New UI endpoint: `POST /export` → streams `history.csv` (timestamp, voltage_in, voltage_out, battery_pct, load_pct, runtime_min)
- Dashboard adds a **Download CSV** button that hits `/export` and triggers a browser download
- File name: `ups-<upsName>-<date>.csv`

**Depends on:** Feature 2 (ring-buffer history)

---

## Feature 4 — Cloud Push `agent/cloud-push`

**Goal:** Forward live UPS data to an external time-series store or webhook for long-term trending and alerting outside HomeKit.

**Supported targets (config-driven, all optional):**
- **InfluxDB v2** — line protocol over HTTP, tag = upsName
- **Generic webhook** — POST JSON payload on every poll
- **MQTT** — publish to `homebridge/ups/<upsName>/<variable>` topics

**Design:**
- New `lib/pushers/` directory, one module per target
- Each pusher is initialised in the platform constructor if the relevant config keys are present
- Push happens after each successful poll, fire-and-forget (errors logged, never throw)
- Zero new production dependencies for InfluxDB and webhook targets (Node `http`/`https` only); MQTT requires `mqtt` package

**Depends on:** Feature 1 (clean data-flow pattern in poll loop)
