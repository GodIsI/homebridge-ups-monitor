'use strict';

/**
 * test/dashboardTabs.test.js
 *
 * Automated coverage for multi-UPS tab-switching behaviour, per the
 * acceptance criteria in issue #241 ("Automated tests cover multi-UPS tab
 * behavior...") and the #242 review's finding 2 (a failed tab must not
 * retain another UPS's charts/outages).
 *
 * dashboard.html has no jsdom dependency in this repo, so this drives the
 * real inline script against the lightweight fake DOM in
 * test/helpers/dashboardScript.js rather than a browser. fetchHistory,
 * updateCharts, renderOutages and fetchOutages are replaced with spies —
 * they're independently covered by their own network/server-backed paths
 * elsewhere; what's under test here is *which UPS* the tab handler and
 * renderActiveUPS() target, and what they render, not their own internals.
 */

const { loadDashboardContext } = require('./helpers/dashboardScript');

/** Load a fresh dashboard context, seed allUPSData/activeUPSIdx, and render tabs. */
function setup(allUPSData, activeUPSIdx = 0) {
  const ctx = loadDashboardContext();
  const calls = [];
  ctx.fetchHistory  = async (name, opts) => { calls.push({ fn: 'fetchHistory', name, opts }); };
  ctx.updateCharts  = (name) => { calls.push({ fn: 'updateCharts', name }); };
  ctx.renderOutages = (name) => { calls.push({ fn: 'renderOutages', name }); };
  ctx.fetchOutages  = async (name) => { calls.push({ fn: 'fetchOutages', name }); };
  ctx.allUPSData = allUPSData;
  ctx.activeUPSIdx = activeUPSIdx;
  ctx.renderTabs(ctx.allUPSData);
  const tabsEl = ctx.document.getElementById('ups-tabs');
  return { ctx, calls, tabButtons: tabsEl._children };
}

/** upsName values passed to one spied function, in call order. */
function callsFor(calls, fn) {
  return calls.filter(c => c.fn === fn).map(c => c.name);
}

const healthy = {
  _upsName: 'ups1', 'ups.status': 'OL',
  'battery.charge': 90, 'ups.load': 20, 'battery.runtime': 3600,
};
const failed = {
  _upsName: 'ups2', _error: 'DATA-STALE: driver not producing data', _errorCode: 'DATA-STALE',
  _errorCategory: 'stale-data', _retryable: true, _guidance: 'Check the driver status.', _lastKnownGood: null,
};
const failedWithHistory = {
  _upsName: 'ups3', _error: 'UNKNOWN-UPS', _errorCode: 'UNKNOWN-UPS', _errorCategory: 'unknown-ups',
  _retryable: false, _guidance: 'Confirm the UPS name.',
  _lastKnownGood: { t: '2026-01-01T00:00:00.000Z', inV: 230, outV: 229, bat: 77, load: 33, runtime: 1800 },
};

describe('dashboard.html — multi-UPS tab switching (#241 acceptance criteria)', () => {
  test('selecting a failed secondary UPS shows the error banner with its structured code and guidance', async () => {
    const { ctx, tabButtons } = setup([healthy, failed], 0);
    await tabButtons[1].onclick();

    expect(ctx.activeUPSIdx).toBe(1);
    expect(ctx.document.getElementById('status-banner').className).toBe('status-banner error');
    expect(ctx.document.getElementById('status-text').textContent).toContain('UPS2');
    expect(ctx.document.getElementById('status-text').textContent).toContain('No data available');
    expect(ctx.document.getElementById('status-detail').textContent).toContain('DATA-STALE');
    expect(ctx.document.getElementById('error-area').style.display).toBe('block');
    expect(ctx.document.getElementById('error-area').textContent).toContain('DATA-STALE');
    expect(ctx.document.getElementById('error-area').textContent).toContain('Check the driver status.');
  });

  test('selecting a failed UPS with a last-known-good reading shows the stale metrics, clearly labelled', async () => {
    const { ctx, tabButtons } = setup([healthy, failedWithHistory], 0);
    await tabButtons[1].onclick();

    expect(ctx.document.getElementById('status-text').textContent).toContain('Last known reading');
    expect(ctx.document.getElementById('status-detail').textContent).toContain('UNKNOWN-UPS');
    expect(ctx.document.getElementById('status-detail').textContent).toMatch(/01 Jan/); // stale timestamp shown (fmtDateTime has no year)
    expect(ctx.document.getElementById('m-battery').innerHTML).toContain('77');
  });

  test('switching from a failed UPS to a healthy UPS clears the stale error presentation', async () => {
    const { ctx, tabButtons } = setup([healthy, failed], 0);
    await tabButtons[1].onclick(); // healthy -> failed
    expect(ctx.document.getElementById('error-area').style.display).toBe('block');

    await tabButtons[0].onclick(); // failed -> healthy
    expect(ctx.document.getElementById('error-area').style.display).toBe('none');
    expect(ctx.document.getElementById('status-banner').className).toBe('status-banner online');
    expect(ctx.document.getElementById('status-text').textContent).toContain('Online');
  });

  test('periodic-refresh and tab-selection paths render an errored UPS identically (shared renderActiveUPS)', async () => {
    const { ctx, tabButtons } = setup([healthy, failed], 0);
    await tabButtons[1].onclick();
    const viaTab = {
      text:   ctx.document.getElementById('status-text').textContent,
      detail: ctx.document.getElementById('status-detail').textContent,
      banner: ctx.document.getElementById('status-banner').className,
    };

    // Drive the same UPS through renderActiveUPS() directly, exactly as
    // fetchData()'s periodic refresh does, and confirm it renders identically.
    ctx.document.getElementById('status-text').textContent = '';
    ctx.document.getElementById('status-detail').textContent = '';
    ctx.renderActiveUPS(failed);
    const viaRenderActiveUPS = {
      text:   ctx.document.getElementById('status-text').textContent,
      detail: ctx.document.getElementById('status-detail').textContent,
      banner: ctx.document.getElementById('status-banner').className,
    };

    expect(viaTab).toEqual(viaRenderActiveUPS);
  });

  test('history, charts, and outages always follow the newly selected UPS, regardless of its error state (#242 review finding 2)', async () => {
    const { calls, tabButtons } = setup([healthy, failed, failedWithHistory], 0);

    await tabButtons[1].onclick(); // healthy -> failed
    expect(callsFor(calls, 'fetchHistory')).toEqual(['ups2']);
    expect(callsFor(calls, 'updateCharts')).toEqual(['ups2']);
    expect(callsFor(calls, 'renderOutages')).toEqual(['ups2']);
    expect(callsFor(calls, 'fetchOutages')).toEqual(['ups2']);

    calls.length = 0;
    await tabButtons[2].onclick(); // failed -> a different failed UPS
    expect(callsFor(calls, 'fetchHistory')).toEqual(['ups3']);
    expect(callsFor(calls, 'updateCharts')).toEqual(['ups3']);
    expect(callsFor(calls, 'renderOutages')).toEqual(['ups3']);
    expect(callsFor(calls, 'fetchOutages')).toEqual(['ups3']);

    calls.length = 0;
    await tabButtons[0].onclick(); // failed -> healthy
    expect(callsFor(calls, 'fetchHistory')).toEqual(['ups1']);
    expect(callsFor(calls, 'updateCharts')).toEqual(['ups1']);
    expect(callsFor(calls, 'renderOutages')).toEqual(['ups1']);
    expect(callsFor(calls, 'fetchOutages')).toEqual(['ups1']);
  });

  test('a healthy UPS renders live metrics via renderUPS, not the error path', async () => {
    const { ctx, tabButtons } = setup([healthy, failed], 1); // start on the failed tab
    await tabButtons[0].onclick(); // -> healthy

    expect(ctx.document.getElementById('status-banner').className).toBe('status-banner online');
    expect(ctx.document.getElementById('m-battery').innerHTML).toContain('90');
  });

  test('renderTabs is hidden entirely for a single-UPS config (existing behaviour, unaffected)', () => {
    const { ctx } = setup([healthy], 0);
    expect(ctx.document.getElementById('ups-tabs').style.display).toBe('none');
  });
});
