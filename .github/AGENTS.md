# Agent Conventions — homebridge-ups-monitor

This file is the authoritative guide for AI agents (GitHub Copilot, Claude, etc.) working on this repository. Read it before touching any code.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, production-ready. Only `develop` may open a PR here. Every merge triggers a GitHub Release + tarball. |
| `develop` | Integration branch. All features and fixes land here first via PR. |
| `feature/<slug>` | Human-initiated features. Branch from `develop`, PR back to `develop`. |
| `agent/<slug>` | Agent-generated work. Same rules as `feature/`. |

### Branch protection (enforced on GitHub)

Both `main` and `develop` have branch protection enabled — **direct pushes are blocked** except for `github-actions[bot]` (needed for automated version bump commits).

**`main`**
- Requires a PR from `develop` only
- Requires all CI checks to pass (`Test (Node 18.x / 20.x / 22.x)`)
- Requires Code Owner review (`@GodIsI`)
- `github-actions[bot]` is a bypass actor (version bump commits)

**`develop`**
- Requires a PR from `feature/*` or `agent/*` branches
- Requires all CI checks to pass (`Test (Node 18.x / 20.x / 22.x)`)
- `github-actions[bot]` is a bypass actor (version bump + main sync commits)

### Branch naming rules

| Work type | Branch pattern | Example |
|-----------|---------------|---------|
| New feature (human) | `feature/<slug>` | `feature/log-export` |
| Agent-generated work | `agent/<slug>` | `agent/log-export` |
| Bug fix | `fix/<slug>` | `fix/history-endpoint-crash` |
| Docs / chore | `chore/<slug>` | `chore/update-readme` |

**Never push directly to `develop` or `main`.** Always use a PR. The only exception is the automated `github-actions[bot]` version-bump commits.

**Never open a PR directly to `main` from a feature branch.** `main` is fed only from `develop`.

---

## Starting a New Task

```bash
git fetch origin
git status                         # must be clean
git log --oneline origin/develop -5
git checkout -b agent/<slug> origin/develop
```

Replace `<slug>` with a short, kebab-case description of the work (e.g., `agent/homekit-tiles`, `agent/ring-buffer-history`).

---

## Before Committing

1. Run tests: `npm test`
2. Confirm the test suite is green.
3. Keep commits atomic — one logical change per commit.
4. Use conventional commit messages:
   - `feat:` new behaviour
   - `fix:` bug fix
   - `test:` test-only changes
   - `refactor:` no behaviour change
   - `docs:` documentation only
   - `chore:` build / tooling

---

## Pull Requests

- PR target is **always `develop`**, never `main`.
- Title: `feat: <short description>` (or `fix:`, `refactor:`, etc.)
- Description must include:
  - What changed and why
  - How to test it manually (e.g., Homebridge restart + HomeKit check)
  - Any config.schema.json changes that affect existing users

---

## Project-Specific Context

### Plugin architecture

```
index.js                       Platform entry — registers NUTDashboard, orchestrates tiles + poll loop
lib/nutClient.js               Pure TCP NUT client. queryNUT() → Promise<Object>
lib/nutParser.js               parseStatusFlags(str) → {onLine, onBattery, charging, lowBattery, raw}
lib/tiles/batteryTile.js       Battery service (charge %, charging state, low-battery alert)
lib/tiles/outletTile.js        Outlet service (On, OutletInUse)
lib/tiles/onBatteryTile.js     OccupancySensor tile (on-battery alert)
lib/tiles/loadTile.js          Lightbulb tile (Brightness = load %)
lib/tiles/inputVoltageTile.js  LightSensor tile — input voltage
lib/tiles/outputVoltageTile.js LightSensor tile — output voltage
lib/tiles/runtimeTile.js       TemperatureSensor tile — runtime in minutes
homebridge-ui/server.js        UI server — POST /ups-status, POST /history (planned)
homebridge-ui/public/          Dashboard HTML/JS/CSS
config.schema.json             Homebridge config UI schema
```

Each tile module exports a single function:
```js
setup(accessory, api, upsName, opts) → { update(data, flags) }
```
`setup()` registers or recovers the HAP service; `update()` is called on every successful poll.

### NUT variable names used

| NUT variable | Meaning |
|---|---|
| `ups.status` | Space-separated flags: OL, OB, CHRG, LB, etc. |
| `battery.charge` | Battery % (0–100) |
| `battery.runtime` | Remaining runtime in **seconds** |
| `ups.load` | Load % (0–100) |
| `input.voltage` | AC input voltage |
| `output.voltage` | AC output voltage |

### HomeKit service conventions

Use `accessory.getService(Service.X) || accessory.addService(Service.X, displayName)` — never `.addService()` unconditionally (causes duplicate service errors on restart).

Services per accessory (one module each in `lib/tiles/`):
- `Battery` — charge, charging state, low battery alert
- `Outlet` — On (UPS providing power), OutletInUse (load > 0)
- `OccupancySensor` — OccupancyDetected = 1 when on-battery
- `Lightbulb` — Brightness = `ups.load` % (0–100)
- `LightSensor` (subtype `input-voltage`) — `input.voltage` as CurrentAmbientLightLevel
- `LightSensor` (subtype `output-voltage`) — `output.voltage` as CurrentAmbientLightLevel
- `TemperatureSensor` — `battery.runtime ÷ 60` minutes as CurrentTemperature

See [FEATURES.md](FEATURES.md) for design rationale and the full roadmap.

### Installation path on Raspberry Pi

Homebridge (hb-service) installs plugins to:
```
/var/lib/homebridge/node_modules/homebridge-ups-monitor/
```
Not the npm global prefix. The `scripts/deploy.sh` script handles this correctly.

### Config platform name

`"platform": "NUTDashboard"` — must match `PLATFORM_NAME` in `index.js` and `pluginAlias` in `config.schema.json`.

---

## Versioning

This project uses **MAJOR.MINOR.PATCH** semantic versioning, bumped automatically by GitHub Actions — **agents must never edit `version` in `package.json` manually**.

| Part | When it changes | Who changes it |
|------|----------------|----------------|
| **MAJOR** | Major rewrite / breaking change to the platform | Human, manual PR to `main` |
| **MINOR** | Any PR merged into `main` (a full release) | `version-minor.yml` — auto-bumps and resets PATCH to 0 |
| **PATCH** | Any PR merged into `develop` (a feature or fix) | `version-patch.yml` — auto-bumps |

### How it works

1. **Feature PR merged → `develop`**
   - `version-patch.yml` runs, bumps PATCH (e.g. `1.0.2` → `1.0.3`)
   - Commits `chore: bump version to 1.0.3` back to `develop`
   - That commit triggers `beta.yml`, which builds and tags a pre-release (`v1.0.3-beta.N`)

2. **`develop` PR merged → `main`** (cutting a release)
   - `version-minor.yml` runs, bumps MINOR and resets PATCH (e.g. `1.0.3` → `1.1.0`)
   - Commits `chore: bump version to 1.1.0` back to `main`
   - Then merges `main` back into `develop` so the next patch cycle starts from `1.1.0`
   - That commit triggers `release.yml`, which builds and tags a stable release (`v1.1.0`)

### Rules for agents

- **Do not** touch `"version"` in `package.json`.
- `beta.yml` and `release.yml` only fire on commits whose message starts with `chore: bump version` — do not use that prefix for anything else.
- If you need to reason about the current version, read it from `package.json`.

---

## What Agents Must Not Do

- Do not merge to `main` directly.
- Do not modify `.github/workflows/` without a discussion comment in the PR.
- Do not manually edit `"version"` in `package.json` — versioning is fully automated (see Versioning section above).
- Do not add npm production dependencies without justification (plugin size matters).
- Do not use `accessory.addService()` without first checking `accessory.getService()`.
- Do not hardcode the Homebridge storage path — always use `this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || path.join(os.homedir(), '.homebridge')`.
