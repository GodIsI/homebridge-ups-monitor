'use strict';

/**
 * test/nutClient.test.js
 *
 * Integration tests for queryNUT() using a mock TCP server that mimics upsd.
 * No real NUT installation required — the mock server responds with canned data.
 */

const net = require('net');
const { queryNUT } = require('../lib/nutClient');

// ── Mock NUT server ───────────────────────────────────────────────────────────

/** Canned data a mock UPS would return */
const MOCK_DATA = {
  'ups.status':            'OL',
  'input.voltage':         '230.5',
  'input.voltage.nominal': '230',
  'output.voltage':        '230.1',
  'output.voltage.nominal':'230',
  'battery.charge':        '85',
  'battery.charge.low':    '20',
  'battery.voltage':       '27.2',
  'battery.voltage.nominal':'24',
  'ups.load':              '42',
  'battery.runtime':       '3600',
  'ups.realpower':         '210',
  'ups.model':             'TestUPS 1500',
  'ups.mfr':               'TestMaker',
};

/**
 * Spin up a minimal upsd-compatible TCP server on a random free port.
 * Responds to GET VAR commands with values from the provided data map.
 * Closes the connection cleanly on LOGOUT.
 *
 * @param {Object} data   Variable map to serve (defaults to MOCK_DATA)
 * @returns {Promise<net.Server>}
 */
function createMockNUTServer(data = MOCK_DATA) {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      let buf = '';

      socket.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // retain any incomplete trailing line

        for (const line of lines) {
          const cmd = line.trim();
          if (!cmd) continue;

          if (cmd === 'LOGOUT') {
            socket.write('OK Goodbye\n');
            socket.end();
            return;
          }

          // USERNAME / PASSWORD — just acknowledge
          if (cmd.startsWith('USERNAME') || cmd.startsWith('PASSWORD')) {
            socket.write('OK\n');
            continue;
          }

          // GET VAR <ups> <variable>
          const m = cmd.match(/^GET VAR (\S+) (\S+)/);
          if (m) {
            const [, upsName, varName] = m;
            if (data[varName] !== undefined) {
              socket.write(`VAR ${upsName} ${varName} "${data[varName]}"\n`);
            } else {
              socket.write('ERR VAR-NOT-SUPPORTED\n');
            }
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('queryNUT — successful queries (mock server)', () => {
  let server;
  let port;

  beforeAll(async () => {
    server = await createMockNUTServer();
    port   = server.address().port;
  });

  afterAll(() => new Promise(resolve => server.close(resolve)));

  test('returns parsed data for a subset of variables', async () => {
    const data = await queryNUT('127.0.0.1', port, 'ups', null, null, [
      'input.voltage', 'battery.charge', 'ups.status',
    ]);
    expect(data['input.voltage']).toBe(230.5);
    expect(data['battery.charge']).toBe(85);
    expect(data['ups.status']).toBe('OL');
  });

  test('coerces numeric strings to JS numbers', async () => {
    const data = await queryNUT('127.0.0.1', port, 'ups', null, null, ['ups.load']);
    expect(typeof data['ups.load']).toBe('number');
    expect(data['ups.load']).toBe(42);
  });

  test('keeps non-numeric strings as strings', async () => {
    const data = await queryNUT('127.0.0.1', port, 'ups', null, null,
      ['ups.status', 'ups.model', 'ups.mfr']);
    expect(typeof data['ups.status']).toBe('string');
    expect(typeof data['ups.model']).toBe('string');
    expect(data['ups.model']).toBe('TestUPS 1500');
  });

  test('silently omits variables the server does not support', async () => {
    const data = await queryNUT('127.0.0.1', port, 'ups', null, null, [
      'input.voltage',
      'nonexistent.variable',
    ]);
    expect(data['input.voltage']).toBe(230.5);
    expect(data['nonexistent.variable']).toBeUndefined();
  });

  test('accepts authentication credentials without error', async () => {
    await expect(
      queryNUT('127.0.0.1', port, 'ups', 'admin', 'secret', ['ups.status'])
    ).resolves.toMatchObject({ 'ups.status': 'OL' });
  });

  test('works with all default NUT_VARS without throwing', async () => {
    await expect(
      queryNUT('127.0.0.1', port, 'ups', null, null)
    ).resolves.toBeDefined();
  });

  test('battery.runtime is returned as a number (seconds)', async () => {
    const data = await queryNUT('127.0.0.1', port, 'ups', null, null, ['battery.runtime']);
    expect(typeof data['battery.runtime']).toBe('number');
    expect(data['battery.runtime']).toBe(3600);
  });
});

describe('queryNUT — error handling', () => {
  test('rejects when no server is listening on the port', async () => {
    // Pick a port that's very unlikely to be in use
    await expect(
      queryNUT('127.0.0.1', 19999, 'ups', null, null, ['ups.status'])
    ).rejects.toThrow();
  });

  test('rejects with timeout when server accepts but never responds', async () => {
    // Track server-side sockets so we can destroy them in cleanup.
    // server.close() only fires its callback once ALL connections have ended —
    // if we don't destroy them explicitly it hangs forever.
    const serverSockets = new Set();
    const silentServer = await new Promise(resolve => {
      const s = net.createServer(socket => {
        serverSockets.add(socket);
        socket.on('close', () => serverSockets.delete(socket));
        // intentionally never send any data
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const silentPort = silentServer.address().port;

    try {
      await expect(
        // 500 ms timeout — much shorter than the Jest test limit
        queryNUT('127.0.0.1', silentPort, 'ups', null, null, ['ups.status'], 500)
      ).rejects.toThrow(/timed out/i);
    } finally {
      serverSockets.forEach(s => s.destroy());
      await new Promise(resolve => silentServer.close(resolve));
    }
  }, 3000); // Jest timeout for this individual test
});
