# GitHub Copilot Review Instructions

## Project Overview

`homebridge-ups-monitor` is a Homebridge v2 platform plugin (Node.js, CommonJS) that monitors a
UPS via NUT (Network UPS Tools) over TCP port 3493. It exposes HomeKit Battery and Outlet
services, and serves a live dashboard through the Homebridge plugin UI.

Key paths:
- `index.js` — platform entry point, poll loop, HomeKit accessory management
- `lib/` — shared modules (nutClient, nutParser, ringBuffer, dailyLog, tiles/)
- `homebridge-ui/server.js` — IPC server for the Homebridge UI custom UI
- `homebridge-ui/public/index.html` — single-page dashboard (vanilla JS, no build step)
- `test/` — Jest unit tests

## Code Style

- CommonJS (`require`/`module.exports`) throughout — no ES module syntax in `.js` files
- Strict mode (`'use strict'`) at the top of every file
- Two-space indentation
- Trailing semicolons required
- `===` / `!==` for equality; `!= null` is acceptable for null/undefined checks
- Unused variables must be removed; unused catch bindings get `/* ignore */` comment

## Security Review Priorities

When reviewing pull requests, pay close attention to:

1. **NUT input parsing** — any data received from the NUT TCP socket (`lib/nutClient.js`,
   `lib/nutParser.js`) must be treated as untrusted. Flag regex patterns that could hang on
   malformed input, and any place where raw NUT output is passed directly to `JSON.parse` or
   `eval`.

2. **Path traversal in file operations** — `homebridge-ui/server.js` handles `storagePath` and
   filename parameters from the UI. Flag any `path.join` or `fs` call that uses user-supplied
   values without validation against an allowlist pattern like
   `/^ups-log-[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}\.csv$/`.

3. **Prototype pollution** — flag any use of `Object.assign`, spread, or `JSON.parse` output
   merged into objects without schema validation.

4. **Secrets in logs** — the plugin config may contain a NUT `password` field. Flag any
   `console.log` or logger call that could print the full config object.

5. **Dependency versions** — flag devDependency-only packages being used in production code
   paths, and any `require` of a module not listed in `dependencies` (only `devDependencies`).

## Testing Expectations

- Every new exported function in `lib/` should have corresponding tests in `test/`
- Tests must not mock `fs` or `net` at the module level — use dependency injection or the
  existing mock NUT server helpers in `test/helpers.js`
- Coverage for new `lib/` code should not drop below the existing baseline

## Homebridge-Specific Patterns

- HomeKit characteristic updates must go through `updateCharacteristic`, never direct property
  assignment on the characteristic object
- Accessory information (model, manufacturer, serial) is set once in `configureAccessory`;
  do not call these setters on every poll
- The plugin must not throw synchronously from `configureAccessory` or the Homebridge process
  will crash — all NUT errors must be caught and logged

## What Not to Flag

- `console.log` / `console.error` calls — the plugin uses these intentionally for Homebridge's
  logging system; `no-console` is disabled in ESLint for this reason
- Empty `catch {}` blocks on best-effort cleanup operations (unlinking temp files) — these are
  intentional and marked with `/* ignore */`
- The `!= null` pattern — used intentionally to check for both `null` and `undefined`
