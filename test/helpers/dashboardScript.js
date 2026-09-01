'use strict';

/**
 * test/helpers/dashboardScript.js
 *
 * Loads the inline <script> from homebridge-ui/public/dashboard.html into a
 * Node `vm` context against a minimal, dependency-free fake DOM, so its
 * rendering logic (renderTabs, renderActiveUPS, showUpsError, renderUPS, ...)
 * can be unit-tested without a browser or a jsdom dependency.
 *
 * Deliberately NOT a general-purpose DOM shim: this repo has no automated
 * frontend test harness (see the risk noted in PR #238/#242), so this stays
 * scoped to exactly what dashboard.html's script needs — enough to drive and
 * assert on the multi-UPS tab-switching behaviour that issue #241 requires
 * automated coverage for.
 *
 * The script's trailing boot IIFE (`(async () => { initCharts(); ... })();`)
 * is stripped before evaluation: it needs Chart.js and a live server, neither
 * of which this harness provides. Tests call the functions they need
 * directly instead (renderTabs(), renderActiveUPS(), etc.) via the returned
 * context, and can replace context.fetchHistory / updateCharts /
 * renderOutages / fetchOutages with spies before doing so, since a plain
 * top-level `function foo(){}` in a vm script is just a mutable property of
 * the context object — later identifier lookups from other functions in the
 * same context see a reassignment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', '..', 'homebridge-ui', 'public', 'dashboard.html');
const BOOT_MARKER = '// ── Boot ';

/** Extract the inline <script>...</script> body, minus the trailing boot IIFE. */
function extractScript() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  // Case-insensitive: dashboard.html always writes lowercase <script>, but
  // this is parsing our own committed file for a test harness, not
  // sanitizing untrusted input — match defensively regardless (flagged by
  // CodeQL js/bad-tag-filter for the case-sensitive form).
  const m = html.match(/<script>([\s\S]*)<\/script>/i);
  if (!m) throw new Error('dashboardScript helper: no inline <script> found in dashboard.html');
  const full = m[1];
  const bootIdx = full.indexOf(BOOT_MARKER);
  if (bootIdx === -1) {
    throw new Error('dashboardScript helper: boot marker comment not found — dashboard.html structure changed');
  }
  const withoutBoot = full.slice(0, bootIdx);

  // Node's `vm` module only exposes top-level `var`/`function` bindings as
  // properties of the context object — top-level `let`/`const` live in a
  // separate declarative environment record the context can't see or set.
  // Rewriting top-level (column-0) `let`/`const` to `var` makes the script's
  // module-level state (allUPSData, activeUPSIdx, ...) visible to and
  // settable by tests, while leaving every function-body-local `let`/`const`
  // (always indented) untouched.
  return withoutBoot.replace(/^(let|const)\s/gm, 'var ');
}

/** A settable stub DOM element: className/textContent/innerHTML/style/etc., plus a child list. */
function makeElement(id) {
  const el = {
    id,
    _children: [],
    _innerHTML: '',
    className: '',
    textContent: '',
    disabled: false,
    href: '',
    download: '',
    style: {},
    onclick: null,
    getContext: () => ({}),
    appendChild(child) { this._children.push(child); return child; },
    removeChild(child) { this._children = this._children.filter(c => c !== child); },
    classList: {
      toggle() {}, add() {}, remove() {},
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; if (v === '') this._children = []; },
  });
  return el;
}

/** Minimal `document` — auto-vivifies a cached stub element per id. */
function makeDocument() {
  const byId = new Map();
  return {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeElement(id));
      return byId.get(id);
    },
    createElement(_tag) { return makeElement(null); },
    querySelectorAll() { return []; },
    body: makeElement('body'),
  };
}

/**
 * Load dashboard.html's inline script into a fresh vm context.
 * @returns {object} the vm context — dashboard.html's top-level functions
 *   and `let`/`const` bindings (renderTabs, renderActiveUPS, allUPSData, ...)
 *   are accessible as properties on it.
 */
function loadDashboardContext() {
  const script = extractScript();
  const document = makeDocument();
  const context = {
    document,
    navigator: { canShare: undefined, userAgent: 'node-test-harness' },
    console,
    Date,
    Math,
    JSON,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => { throw new Error('fetch() was not expected to be called in this test — spy the caller instead'); },
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'dashboard.inline-script.js' });
  return context;
}

module.exports = { loadDashboardContext, extractScript };
