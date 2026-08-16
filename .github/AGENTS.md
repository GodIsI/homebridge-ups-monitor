# Agent Conventions — homebridge-ups-monitor

This file is the authoritative guide for AI agents (GitHub Copilot, Claude, Codex, etc.) working on this repository. Read it before touching any code.

---

## Session Setup (run at the start of every session)

Follow the [Plimmerton Labs organisation-wide session start checklist](https://github.com/Plimmerton-Labs/engineering-playbook/blob/develop/AGENTS.md#session-start-checklist) first — pull latest `develop`, check open PRs, check existing branches.

Then authenticate for GitHub API and git operations using the **GitHub App token helper** from the engineering playbook. The private key lives in the `engineering-playbook` repo (never committed here).

```sh
# From the engineering-playbook directory (checked out alongside this repo):
export GITHUB_APP_ID="4141859"
export GITHUB_APP_INSTALLATION_ID="142521991"
export GITHUB_APP_PRIVATE_KEY_PATH="../engineering-playbook/secrets/name-plimmerton-labs-ai-agents.2026-06-25.private-key.pem"
export PLIMMERTON_AI_AGENT_TOKEN="$(node ../engineering-playbook/scripts/github-app-token.mjs)"
```

Set the remote URL so git push uses the token:

```sh
git remote set-url origin "https://oauth2:${PLIMMERTON_AI_AGENT_TOKEN}@github.com/Plimmerton-Labs/homebridge-ups-monitor.git"
```

Verify with `git ls-remote --heads origin`.

When creating commits via the GitHub API, use the bot committer identity (exported as `BOT_COMMITTER` from `scripts/github-app-token.mjs` in the engineering playbook):

```text
name:  Plimmerton Labs AI Agents
email: 296834291+plimmerton-labs-ai-agents[bot]@users.noreply.github.com
```

---

## Skills (git submodule)

Reusable AI skills live in the `skills/` git submodule (source: <https://github.com/davidamitchell/Skills>). Each subdirectory holds one `SKILL.md` prompt file covering a research, writing, or engineering workflow.

They are **not** pulled by a plain `git clone`. Initialise them once after cloning:

```bash
git submodule update --init --recursive
```

Read the relevant `skills/<name>/SKILL.md` before starting a task it covers. Ones useful in this repo:

- `code-review`, `tdd`, `swe` — engineering workflow
- `technical-writer`, `plain-language`, `remove-ai-slop` — docs and README work
- `research`, `research-question`, `citation-discipline` — investigation tasks

The submodule is pinned to a specific commit. Update it deliberately with `git submodule update --remote skills` in its own `chore/` PR, never as a side effect of unrelated work.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, production-ready. Only `develop` may open a PR here. Every merge triggers a GitHub Release + tarball. |
| `develop` | Integration branch. All features and fixes land here first via PR. |
| `feature/<slug>` | Human-initiated features. Branch from `develop`, PR back to `develop`. |
| `agent/<agent>/<slug>` | Agent-generated work. Same rules as `feature/`. |

### Branch protection (enforced on GitHub)

Both `main` and `develop` have branch protection enabled — **direct pushes are blocked for everyone**.

**`main`**
- Requires a PR (from `develop` only)
- Requires all CI checks to pass (`Test (Node 18.x / 20.x / 22.x / 24.x)`)
- Requires Code Owner review (configured in repository branch protection settings)

**`develop`**
- Requires a PR (from `feature/*`, `agent/*`, or `chore/*` branches)
- Requires all CI checks to pass (`Test (Node 18.x / 20.x / 22.x / 24.x)`)

### Branch naming rules

| Work type | Branch pattern | Example |
|-----------|---------------|---------|
| New feature (human) | `feature/<slug>` | `feature/log-export` |
| Agent-generated work | `agent/<agent>/<slug>` | `agent/claude/log-export` |
| Bug fix | `fix/<slug>` | `fix/history-endpoint-crash` |
| Docs / chore | `chore/<slug>` | `chore/update-readme` |
| Automated version bump | `chore/version-bump-X.Y.Z` | created by `version-patch.yml` / `version-minor.yml` |
| Automated develop sync | `chore/sync-main-X.Y.Z` | created by `sync-develop.yml` |

**Never push directly to `develop` or `main`.** Always use a PR.

**Merge-method policy (see [docs/RELEASE.md](../docs/RELEASE.md)):** squash-merge feature PRs into `develop`, but use a **merge commit (never squash)** for the `develop → main` promotion and the `main → develop` version sync-back. Squashing those syncs breaks branch ancestry and makes `package.json` version conflicts recur every release.

**Never open a PR directly to `main` from a feature branch.** `main` is fed only from `develop`.

---

## Starting a New Task

```bash
git fetch origin
git status                         # must be clean
git log --oneline origin/develop -5
git checkout -b agent/claude/<slug> origin/develop
git push -u origin agent/claude/<slug>    # sets upstream to the agent branch, not develop
```

Replace `<slug>` with a short, kebab-case description of the work.

**Never skip `git push -u origin agent/claude/<slug>` before committing.** Without it, git push defaults to develop, bypassing the PR process.

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
- Use the pull request template at [pull_request_template.md](pull_request_template.md).
- Description must include:
  - what changed and why;
  - relevant playbook principles or operating-model concerns;
  - assumptions made;
  - validation performed, including `npm test` where relevant;
  - risks, limitations, and follow-up work;
  - any `config.schema.json` changes that affect existing users.

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

### How it works (PR-based, no direct pushes)

1. **Feature PR merged → `develop`**
   - `version-patch.yml` runs, bumps PATCH
   - Opens `chore/version-bump-X.Y.Z` → `develop` with auto-merge enabled
   - CI passes → PR auto-merges
   - Triggers `beta.yml` (GitHub pre-release) and `publish.yml` (npm beta)

2. **`develop` PR merged → `main`** (cutting a release)
   - `version-minor.yml` runs, bumps MINOR and resets PATCH
   - Opens `chore/version-bump-X.Y.Z` → `main` with auto-merge enabled
   - CI passes → PR auto-merges
   - Triggers `release.yml` (GitHub stable release) and `publish.yml` (npm latest)
   - `sync-develop.yml` opens `chore/sync-main-X.Y.Z` → `develop` carrying the version back

### Rules for agents

- **Do not** touch `"version"` in `package.json`.
- `beta.yml`, `release.yml`, and `publish.yml` only fire on commits whose message starts with `chore: bump version` — do not use that prefix for anything else.
- **`publish.yml` is the single source of truth for npm publishing.** All changes to Node version, OIDC config, or publish logic must be made in `publish.yml` only.
- npm OIDC Trusted Publishing requires **Node 24** (ships npm 11). Do not downgrade in `publish.yml`.
- If you rename or split `publish.yml`, the Trusted Publisher entry must be updated on npmjs.com.

---

## Homebridge Verification — must not regress

This plugin is going through (and must keep passing) the **Verified by Homebridge** check tracked at <https://github.com/homebridge/plugins/issues/1068>. Treat verification as a **hard gate**, on the same level as the test suite.

### The reproduction lives in CI

`test/verification.test.js` reproduces the verifier locally and runs as part of `npm test`. It checks:

1. **Static manifest rules** — `config.schema.json` `required` must be an array; `homebridge` must stay a devDependency; no install hooks; `pluginAlias` must match `PLATFORM_NAME`.
2. **Minimal-config startup** — the platform starts with `{ "platform": "NUTDashboard" }` and no reachable NUT server, asserting it never throws and writes nothing to the storage root.

### Rules for agents

- **Any PR that touches `index.js`, `lib/`, `config.schema.json`, `package.json`, or `.github/workflows/` must keep `test/verification.test.js` green.**
- **Never make the plugin write data files on startup.** History/CSV/outage files are created lazily, only after the first successful poll.
- **Never write outside the Homebridge storage dir.**
- **The plugin must start and degrade gracefully with only `{ "platform": "NUTDashboard" }`.** Missing config must fall back to safe defaults and log — never throw.
- If you change verification-relevant behaviour, update both `test/verification.test.js` and [docs/VERIFICATION.md](../docs/VERIFICATION.md) in the same PR.

---

## What Agents Must Not Do

- Do not merge to `main` directly.
- Do not modify `.github/workflows/` without a discussion comment in the PR.
- Do not manually edit `"version"` in `package.json`.
- Do not add npm production dependencies without justification.
- Do not modify `.github/workflows/publish.yml` Node version or OIDC settings without understanding npm Trusted Publishing requirements (Node 24 + npm 11 minimum).
- Do not use `accessory.addService()` without first checking `accessory.getService()`.
- Do not hardcode the Homebridge storage path — always use `this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || path.join(os.homedir(), '.homebridge')`.
- Do not make the plugin create files or directories on startup — data files are written lazily after the first successful poll.
- Do not merge a PR touching `index.js`, `lib/`, `config.schema.json`, or `package.json` without `test/verification.test.js` passing.
