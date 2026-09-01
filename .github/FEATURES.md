# Feature Roadmap — homebridge-ups-monitor

Features are tackled independently, each on its own `agent/<slug>` branch from `develop`.
See [AGENTS.md](AGENTS.md) for branch / PR conventions.

## Current status

All planned product features are implemented and merged. The remaining external milestone is **Homebridge plugin validation / verification**:

- Features **1-7** and **10-12** are complete.
- Feature **8** readiness work is complete from this repo's side; the remaining step is the Homebridge validation outcome.
- Feature **9** dependency hygiene has been triaged with Socket configuration and audit workflow coverage; continue monitoring new dependency alerts as maintenance.

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

## Feature 4 — Export & Share ✅ `agent/export-share`

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

## Feature 5 — Standalone Dashboard Server ✅ `agent/standalone-dashboard`

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

---

## Fixes & Polish — Dashboard ✅ `agent/standalone-dashboard` (PR #68 → `develop`)

**Goal:** Make the standalone dashboard the single, reliable way to view UPS data and fix the history charts.

**Delivered:**
- **Removed `customUi`** from `config.schema.json` — the embedded config-panel dashboard never rendered its JSON. Homebridge now shows the standard settings form; the standalone dashboard (Feature 5) is the viewer. Added `headerDisplay`/`footerDisplay` + clearer field text linking to it. (Kept `singular: true` from #64.)
- **Chart time-range fixed** — charts use a `linear` x-axis pinned to the selected window, so **1h / 6h / 12h / 24h** each span their full range (previously stuck at ~1h). Added the **12h** button.
- **~24h history retention** — ring buffer sized from the poll interval (2880 points at 30s, bounded 8640). Readers use `adopt` mode to take on the stored file's capacity instead of wiping history on a size mismatch. ⚠️ one-time history reset on first run after upgrade (see `CHANGELOG.md`).
- **No new CDN dependency** — the time axis uses Chart.js's built-in `linear` scale + tick/tooltip formatter (dropped a `chartjs-adapter-date-fns` script that CodeQL flagged as an untrusted source).
- **Docs** — README reworked to describe the dashboard as standalone-only; added `CHANGELOG.md`.
- 1 new ring-buffer test; **177 total passing**.

**Status:** ✅ merged (#68, #70).

---

## Feature 6 — NUT Control Commands (close the functionality gap) ✅ `agent/nut-controls`

**Goal:** Add the two UPS *control* capabilities `homebridge-ups` has and we currently lack, so `homebridge-ups-monitor` is a functional superset. Prerequisite for the verification request (Feature 8).

**Scope:**
- **Audible alarm toggle** — a HomeKit `Switch` that enables/disables the UPS beeper via NUT `INSTCMD` (`beeper.enable` / `beeper.disable`, or `beeper.mute`).
- **Low-battery threshold (set)** — make the configured threshold writable to the UPS where supported via NUT `SET battery.charge.low`, in addition to the existing HomeKit Low-Battery alert.

**Implementation notes:**
- `lib/nutClient.js` — add authenticated command support: NUT `USERNAME` / `PASSWORD` then `INSTCMD <ups> <cmd>` and `SET VAR <ups> <var> <value>`; parse `OK` / `ERR` responses.
- Requires `upsd.users` credentials with `actions = SET` and `instcmds = ALL`; the existing `username`/`password` config feeds this. Degrade gracefully (log, don't throw) when the UPS or credentials don't permit control — many UPSes are monitor-only.
- New tile module(s) under `lib/tiles/` following the `setup(accessory, api, upsName, opts) → { update() }` pattern; only register control services when the NUT variable/command is advertised by the device.
- Tests with a mock NUT server for INSTCMD/SET success, ERR, and unsupported-command paths.

**Delivered:** authenticated NUT command support, optional alarm switch, optional low-battery threshold sync, schema options, and tests for supported/unsupported/denied control paths.

**Risks:** control commands vary by UPS model and require privileged `upsd.users`; must never throw on unsupported hardware.

**Depends on:** existing `nutClient` / tile architecture.

---

## Feature 7 — Reactive Dashboard Link in Settings UI ✅ `agent/settings-live-link`

**Goal:** Make the dashboard URL shown in the plugin settings reflect the **actual** `standalonePort` the user types, instead of a static `PORT` / `8581` placeholder (see config-UI screenshot).

**Why it isn't possible today:** `headerDisplay` / `footerDisplay` in `config.schema.json` are *static* markdown — Homebridge renders them once and they can't read live field values.

**Approach:** add a minimal **custom UI** page via `@homebridge/plugin-ui-utils` that:
- renders the standard schema form (`homebridge.showSchemaForm()` / lets the schema render), and
- reads the current config (`homebridge.getPluginConfig()`), then renders a clickable `http://homebridge.local:<port>` link that updates reactively as the port field changes (listen for change events), with a copy button.

**Important distinction:** this is a *link-only* custom UI — it does **not** re-introduce the full embedded dashboard that previously failed to render (that was removed in the Fixes & Polish work). Scope is deliberately tiny to avoid regressing the config screen.

**Risks:** custom UI replaces the default settings renderer, so the schema form must be re-shown correctly; verify it doesn't reintroduce the blank-panel issue. Test on Homebridge UI ≥ current.

**Delivered:** lightweight settings UI entry point that renders the standard schema form and shows the dashboard link using the configured standalone port, without reintroducing the embedded dashboard.

**Depends on:** none (independent polish).

---

## Feature 8 — "Verified by Homebridge" Readiness ✅ / awaiting validation `agent/verification-readiness`

**Goal:** Meet every published [verification requirement](https://github.com/homebridge/plugins#plugin-verification) (criteria last updated 2024-11-02), then submit a verification request issue to `homebridge/plugins`.

### Positioning — complement to the verified `homebridge-ups`
`homebridge-ups` (by Erik Baauw) already holds the NUT/UPS slot. It is **HomeKit-centric**: exposes UPS status/battery to Home, adds **control** (toggle audible alarm, set low-battery threshold), keeps **Eve-app history**, and ships a `ups` CLI. All of its observability lives inside Apple's ecosystem.

`homebridge-ups-monitor` is positioned as an **observability & data-portability extension**, offering what `homebridge-ups` does not:
- **Standalone web dashboard** — live UPS view + charts in *any* browser on the network (Android, Windows, wall tablet), no Home app / Eve required.
- **Historical charts** with 1h / 6h / 12h / 24h ranges, backed by a ~24h server-side ring buffer.
- **CSV / log export** — one-click 24h export and 30-day daily logs for spreadsheets and long-term analysis.
- **Richer HomeKit tiles** — input/output voltage, load %, runtime, on-battery occupancy as native services for automations.

With Feature 6 adding control parity, we are a genuine superset rather than only a complement.

### Compliance audit & status
Already compliant: dynamic platform; npm + GitHub repo with issues; config Settings GUI; no analytics; no post-install scripts; files written only under the Homebridge storage dir; GitHub release notes per version (automated changelog + beta tag alignment).

Repo-side readiness work is complete:
1. **Node 18 / 20 / 22 / 24 support** — CI tests all supported Node versions, including Node 24.
2. **Error-handling audit** — NUT failures, ring-buffer/file I/O, migrations, and standalone server errors degrade gracefully with tests.
3. **Configuration/startup behaviour** — standalone dashboard starts only when configured with a valid port; invalid ports log and skip startup.
4. **README / badge polish** — README positions the plugin clearly, avoids a premature verification badge, and documents the relationship to `homebridge-ups`.
5. **Validation** — plugin validation has been submitted; awaiting Homebridge review/outcome.

**Depends on:** Feature 6 (control parity strengthens the verification case).

---

## Feature 9 — Dependency Hygiene / Socket.dev Alert Triage ✅ `agent/dependency-hygiene`

**Goal:** Resolve or formally triage the Socket.dev dependency alerts so the published package presents a clean supply-chain profile.

**Context:** Alerts are *Dependency Alerts* (the dependency tree), not our own code. The only **runtime** dependency is `@homebridge/plugin-ui-utils`; `jest`, `eslint`, `@eslint/js`, and `conventional-changelog-cli` are **devDependencies** and are **not** included in the npm tarball users install. Most flags (eval, shell access, network, URL strings, dynamic require, filesystem, "unpopular/unmaintained/deprecated") originate in the dev tree.

**Scope:**
1. **Separate runtime vs dev risk** — confirm which alerts are reachable in the *published* package (runtime deps only). Audit `@homebridge/plugin-ui-utils` and its transitive tree for the flagged behaviors; document that dev-only alerts don't ship.
2. **Shrink the dev footprint** — `conventional-changelog-cli` pulls a large tree (a likely source of several alerts). Consider removing it from `devDependencies` and invoking it via `npx --yes conventional-changelog-cli@5` only in CI (the bump workflows already do this), so it's not in `package-lock.json`/the dev install at all.
3. **Identify the Deprecated + Unmaintained packages** — pin, replace, or document; raise upstream if needed.
4. **Formal triage** — add a Socket config (`socket.yml`) acknowledging accepted dev-only alerts with written justifications, so the dashboard reflects reviewed status rather than open warnings.
5. **Optional** — add a Socket / `npm audit` gate to CI (an `audit.yml` already exists) to catch new high-severity dependency issues going forward.

**Outcome:** a clean (or fully-triaged) Socket profile and a smaller dependency surface in the shipped package — supports the verification effort (Feature 8) and user trust.

**Delivered:** Socket configuration limits PR alerts to dependency manifest changes and documents accepted alert handling; dependency audit workflow remains in CI. Continue treating new alerts as maintenance.

**Depends on:** none (independent hygiene); coordinate with the changelog tooling added for release notes.

---

## Feature 10 — Tidy Data File Storage ✅ `agent/data-subdir`

**Goal:** Stop scattering data files across the Homebridge storage root. Keep them, but inside a dedicated subdirectory of the storage path.

**Context:** The plugin currently writes `ups-history-<ups>.json` and `ups-log-<ups>-YYYY-MM-DD.csv` directly into `<storage>/` (e.g. `/var/lib/homebridge/`), cluttering it alongside `config.json`, `accessories/`, etc. This is verification-compliant (files live in the storage dir, never in `node_modules`, which is wiped on update) but untidy.

**Scope:**
1. **Dedicated subdirectory** — write all plugin data under `<storage>/homebridge-ups-monitor/` (created on startup). Update the path resolution in `index.js`, `lib/ringBuffer.js`, `lib/dailyLog.js`, `lib/dashboardServer.js`, and `homebridge-ui/server.js` so the writer and all readers agree.
2. **One-time migration** — on startup, move any existing `ups-history-*.json` / `ups-log-*.csv` from the storage root into the subdirectory so history/logs aren't lost. Best-effort; log and skip on error.
3. **Stay in the storage dir** — never write to the package directory; keep resolving the storage path the existing way (`UIX_STORAGE_PATH` → `~/.homebridge`).
4. **Cleanup (related)** — de-duplicate stale case-variant files (e.g. `ups-history-CyberPower.json` vs `ups-history-cyberpower.json`) created when a UPS name's casing changed. Decide whether to normalize the on-disk key or just document that NUT UPS names are case-sensitive.

**Tests:** path-resolution + migration unit tests (mock storage dir with pre-existing root files → assert they move into the subdir and are still read).

**Outcome:** a clean storage root and a self-contained data folder — easier to back up, inspect, and reason about; supports the verification/tidiness goals.

**Delivered:** plugin data now resolves under `<storage>/homebridge-ups-monitor/`, with best-effort migration from legacy root and previous storage locations.

**Depends on:** none.

---

## Feature 11 — Outage Timeline & Acknowledgement ✅ `agent/outage-timeline`

**Goal:** Turn `ups.status` transitions into a clear outage history so users can see when power failed, when it recovered, how long the outage lasted, and whether the latest outage has been acknowledged.

This should extend the dashboard's observability story without making the plugin control-heavy. The feature should answer the practical home-user questions: "Did the power go out?", "When?", "For how long?", and "Have I already dealt with this?"

**Delivered:**
- `lib/outageLog.js` persists per-UPS outage events under the existing `homebridge-ups-monitor/` data directory.
- Polling in `index.js` records online/on-battery transitions, resumes active outages after restart, and captures low-battery observations.
- Shared telemetry endpoints expose `/outages`, `/outages/acknowledge`, and `/outages/clear` in both the standalone dashboard server and Homebridge UI server.
- Dashboard shows the latest outage card, timeline, acknowledgement, and clear controls.
- README documents the important setup limitation: Homebridge/Raspberry Pi and NUT must stay powered for complete outage logging.
- Unit and dashboard server endpoint tests cover transition detection, acknowledgement, clearing, restart resume, and malformed event files.

### Dashboard experience

- Add a **latest outage** tile/card near the status summary:
  - show **None recorded** when no outage has been captured;
  - show the most recent outage as `from → to` with duration when recovered;
  - show `Started <time> — ongoing` while currently on battery;
  - show an **Unacknowledged** state until the user acknowledges it.
- Add an **Outage Timeline** section listing recent outages newest-first:
  - start time;
  - end time, or `ongoing`;
  - duration;
  - starting/ending battery percentage when available;
  - lowest battery percentage seen during the outage when available;
  - acknowledged/unacknowledged state.
- Add clear user actions:
  - **Acknowledge latest**: marks the latest completed or ongoing outage as acknowledged but keeps it in history.
  - **Clear timeline**: removes stored outage history after confirmation. This should not affect the normal voltage/battery/load history charts or daily CSV logs.

### Persistence and logging

- Persist outage events under the existing `<storage>/homebridge-ups-monitor/` data directory.
- Detect outage boundaries from NUT status flags:
  - outage starts when `flags.onBattery` becomes true;
  - outage ends when `flags.onBattery` becomes false after an active outage;
  - mark low-battery state during the event if `flags.lowBattery` is observed.
- Keep the event log best-effort and resilient:
  - if Homebridge restarts during an outage, preserve and resume the active outage where possible;
  - if the event file is missing or malformed, log a warning and continue monitoring;
  - do not crash Homebridge on event-log read/write errors.
- Consider adding an outage CSV export later, but keep the first implementation focused on the dashboard timeline and persisted JSON event log.

### Setup guidance

Document the important limitation: the plugin can only log outages while Homebridge and the Raspberry Pi/server running it remain powered and online. For useful outage logging, the Homebridge host should itself be powered by the UPS being monitored, and NUT should keep running during the outage.

If the Raspberry Pi or Homebridge server loses power before or during the outage, the plugin may miss the event, lose the end time, or only record partial history.

### Tests

- Unit-test outage transition detection:
  - online → on battery starts an outage;
  - on battery → online completes an outage;
  - repeated on-battery polls update the active outage without creating duplicates;
  - low-battery observations are captured;
  - restart/resume behavior preserves an active outage where practical.
- Test acknowledgement and clear operations.
- Test malformed/missing event-log files degrade gracefully.
- Add dashboard server endpoint tests for timeline read, acknowledge latest, and clear timeline.

### Risks

- Avoid false duplicate outages from repeated `OB` polls.
- Avoid losing an active outage when Homebridge restarts.
- Keep user actions explicit: acknowledging should not delete history; clearing should require confirmation.
- Do not imply the plugin can record outages while the host running Homebridge is itself offline.

**Depends on:** existing `parseStatusFlags`, storage subdirectory, dashboard API, and standalone dashboard UI.

---

## Feature 12 — Outage Export ✅ `agent/outage-export`

**Goal:** Let users export the persisted outage timeline as CSV so power-failure events can be reviewed, shared, or analysed separately from the regular voltage/battery/load telemetry exports.

Keep this as a separate export from **Last 24 Hours** and **Last 30 Days**. Those existing exports are telemetry streams; outage events are sparse event records with different fields, so a dedicated outage export keeps each CSV clean and predictable.

**Delivered:**
- Shared outage CSV builder emits the dedicated event schema newest-first.
- Standalone dashboard and Homebridge UI server expose `POST /outages/export`.
- Dashboard Export & Share section adds an **Outage Timeline** export card using the existing share/download flow.
- Export action is disabled when no outage events exist.
- Tests cover CSV generation, endpoint behavior, and Homebridge UI handler behavior.

### Dashboard experience

- Add an **Outage Export** action near the Outage Timeline controls or in the Export & Share section.
- Use the same share/download flow as the existing CSV exports:
  - mobile: native share sheet when supported;
  - desktop/fallback: direct CSV download.
- Disable or clearly no-op the export action when no outage events exist.

### CSV format

Suggested columns:

| Column | Source |
|---|---|
| `ups_name` | event UPS name |
| `start` | outage start ISO timestamp |
| `end` | outage end ISO timestamp, blank if ongoing |
| `duration_sec` | outage duration in seconds, blank if ongoing |
| `ongoing` | boolean |
| `acknowledged` | boolean |
| `acknowledged_at` | acknowledgement timestamp, blank if not acknowledged |
| `start_battery_pct` | battery charge at outage start, when available |
| `end_battery_pct` | battery charge at recovery, when available |
| `lowest_battery_pct` | lowest observed battery charge during outage |
| `low_battery` | whether low-battery status was observed during outage |

### Server/API

- Add a shared telemetry helper to build outage CSV from `ups-outages-<upsName>.json`.
- Add matching endpoints in both transports, for example `POST /outages/export`.
- Return `{ success, upsName, filename, csv }`, matching the existing export endpoint shape.

### Tests

- Unit-test CSV generation with no events, completed events, ongoing events, acknowledged events, and nullable battery fields.
- Add standalone dashboard server endpoint tests for outage export.
- Add Homebridge UI server handler tests for outage export.
- Browser-sanity check that the new export action disables/enables correctly.

**Depends on:** Feature 11 outage timeline persistence and dashboard controls.

## Feature 13 — NUT Error Diagnostics ✅ `agent/claude/surface-nut-errors`

**Goal:** Stop `parseNUTResponse()` from silently discarding NUT protocol errors (`ERR DATA-STALE`, `ERR UNKNOWN-UPS`, `ERR ACCESS-DENIED`, …). Previously a failed query resolved as an empty data object, which both the poll loop and the dashboard misread as "unknown status" instead of a real failure — no indication a driver, USB link, UPS name, or credential problem needed attention (issue #237).

**Delivered:**
- `lib/nutParser.js`: `NUT_ERROR_CATALOG` classifies every NUT protocol error code into a category (`unsupported` / `stale-data` / `unknown-ups` / `auth` / `server`), a `retryable` flag, and human-readable guidance; `parseNUTErrors()` extracts structured `{ code, message, category, retryable, guidance }` objects from a raw response buffer. `VAR-NOT-SUPPORTED` and friends stay in the `unsupported` category and remain silent — polling an optional variable a UPS doesn't have is not a failure.
- `lib/nutClient.js`: `queryNUT()` now rejects with a `NUTQueryError` (`code`, `category`, `retryable`, `guidance`, `upsName`) when a query returns any non-`unsupported` error, instead of silently resolving with a hollow object.
- `index.js`: the poll loop's error log includes the guidance text when present, and — because `queryNUT()` now actually rejects for these cases — never pushes an all-null point into the ring buffer, daily log, or outage log for a failed poll (telemetry integrity).
- `lib/dashboardServer.js` and `homebridge-ui/server.js`: a failed `/ups-status` query for one UPS now returns `_errorCode`, `_errorCategory`, `_retryable`, `_guidance`, and `_lastKnownGood` (the most recent persisted telemetry point, if any) alongside the existing `_error` message.
- Dashboard UI (`homebridge-ui/public/dashboard.html`): shows the guidance text in the error banner and, when a last-known-good reading exists, keeps displaying those metrics — clearly marked as stale, with the reading's timestamp and the NUT error code — instead of going blank.

### Tests

- `parseNUTErrors()` classification for every catalogued code plus an unrecognised fallback.
- `queryNUT()` rejects with the right `NUTQueryError` shape for `DATA-STALE`, `UNKNOWN-UPS`, and `ACCESS-DENIED`, and still resolves normally when only optional variables are unsupported; a recovery scenario (failed query followed by a healthy one).
- Poll-loop tests: guidance text reaches the log, a failed poll writes to none of the three stores, and a subsequent successful poll writes a real (non-null) point.
- Standalone dashboard server and Homebridge UI server tests cover the enriched `/ups-status` error payload and `_lastKnownGood` (present and absent cases).

**Depends on:** Feature 2 ring-buffer history (source of `_lastKnownGood`), Feature 5 standalone dashboard server.

### Addendum — closing gaps found in review (issue #241)

A follow-up review of this feature (opened as issue #241 right after the initial PR merged) found three gaps where the diagnostics above didn't fully cover the original problem or introduced a smaller version of it:

1. **Tab-click bypassed error rendering.** `renderTabs()`'s per-tab `onclick` handler called `renderUPS()` directly and never `showUpsError()`, so switching to a UPS with an active error via the tab bar showed stale/blank metrics instead of the error banner and last-known-good reading — and switching back to a healthy UPS could leave a previous error banner on screen. Fixed by factoring both call sites (the periodic `fetchData()` refresh and the tab-click handler) onto one shared `renderActiveUPS()` function, so they cannot diverge again.
2. **All-unsupported queries still resolved as "success".** `queryNUT()` only rejected when a query returned a non-`unsupported` NUT error; if literally every requested variable came back `VAR-NOT-SUPPORTED` (e.g. a driver that doesn't expose any of the standard variable set), `surfaced` was empty and the query resolved with `{}` — the exact "success with blank telemetry" failure mode issue #237 was meant to eliminate, just via a different NUT error code. `queryNUT()` now also rejects with a `NUTQueryError` (category `unsupported`, non-retryable) when the parsed data object is empty and at least one unsupported-category error was present.
3. **`_lastKnownGoodFor()` trusted the newest point unconditionally.** Both `lib/dashboardServer.js` and `homebridge-ui/server.js` returned `points[points.length - 1]` with no check that the point actually carried a reading, so a legacy all-null point (written by a pre-#238 build during a failed poll) could be mislabeled as "last known good." The check now lives once in `lib/telemetryStore.js` (`hasUsableMetric()` / `lastKnownGood()`, walking backward past any all-null trailing points) and both transports delegate to it — keeping the "don't let the two transports drift" principle this module was built around.

**Additional tests:** `queryNUT()` rejecting when every requested variable — including the full default `NUT_VARS` list — is unsupported, and still resolving when only some are; `telemetryStore.lastKnownGood()`/`hasUsableMetric()` unit tests (newest-usable-point selection, skipping one or several trailing all-null points, all-null history, no history, and the `0`-is-a-valid-reading edge case); standalone dashboard server and Homebridge UI server regression tests confirming `_lastKnownGood` in the `/ups-status` response skips a seeded all-null trailing point.

### Addendum 2 — PR #242 review, round 2

A review of the addendum-1 PR itself (posted as a PR review, not a new issue) found three more Medium-severity gaps in that work before merge:

1. **The all-unsupported fix from addendum 1 only covered part of the "empty telemetry" surface.** `queryNUT()`'s empty-data guard only fired when `parseNUTErrors()` found at least one `ERR` line. A clean connection close, a truncated reply, or a reply containing only `OK Goodbye` produces zero `VAR` lines *and* zero `ERR` lines, so the guard didn't fire and the query still resolved with `{}`. Fixed by rejecting whenever the parsed data is empty regardless of whether any `ERR` line was present, distinguishing "every variable unsupported" (category `unsupported`, non-retryable) from "upsd answered nothing at all" (category `server`, retryable — usually a transient connection problem) so the guidance stays accurate either way.
2. **A failed UPS tab could retain the previously-viewed UPS's charts and outage timeline.** The tab-click handler's shared rendering fix (addendum 1) gated `fetchHistory()`/`updateCharts()`/`renderOutages()`/`fetchOutages()` behind `!ups._error`, mirroring `fetchData()`. But those calls are keyed by `upsName` and read data independent of whether the *live* query just succeeded — gating them meant switching to a failed tab could leave a healthy UPS's chart and outage list on screen under the failed UPS's label. Fixed by dropping that gate from the tab handler entirely (it stays only inside `renderActiveUPS()`, which is specifically about the live-query result) — history, charts, and outages now always follow the newly selected tab.
3. **No automated coverage for multi-UPS tab behavior**, despite it being an explicit acceptance criterion in #241. Addressed by adding `test/helpers/dashboardScript.js`, a small dependency-free harness that loads `dashboard.html`'s inline script into a Node `vm` context against a minimal fake DOM (no jsdom), and `test/dashboardTabs.test.js`, which drives the real tab-click handler through healthy/failed/different-failed transitions and asserts on banner state, structured error/guidance text, last-known-good stale-metric rendering, and — for finding 2 above — that history/chart/outage calls always target the newly selected UPS.

A process gap was also raised: #241 had `agent:go` but no `stage:*` label while work was in progress. Corrected by applying `stage:in-review` (not the reviewer's suggested `stage:in-progress` — PR #242 already existed at that point, and `WORKFLOW.md`'s lifecycle moves to `in-review` once a PR is open, not before).
