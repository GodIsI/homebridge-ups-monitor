'use strict';

/**
 * test/platform.test.js
 *
 * Unit tests for NUTDashboardPlatform — specifically the five HomeKit tile
 * services added in Feature 1.  We stub queryNUT so no real NUT server is
 * needed, and build a minimal HAP-like mock that records characteristic
 * updates without requiring the full homebridge runtime.
 */

// ── Mock queryNUT ──────────────────────────────────────────────────────────────
jest.mock('../lib/nutClient', () => ({
  queryNUT: jest.fn(),
}));

// ── Mock DashboardServer so the standalone server never binds a real socket ────
jest.mock('../lib/dashboardServer', () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(0),
    stop:  jest.fn().mockResolvedValue(),
  }));
});

// ── Stop poll timers from leaking open handles across tests ───────────────────
// setupPolling() runs an immediate poll and then self-schedules the next one via
// setTimeout().  We replace setTimeout with a no-op so no real timer is queued;
// the immediate first poll still runs, which is all our assertions need.
beforeEach(() => {
  jest.spyOn(global, 'setTimeout').mockReturnValue(1);
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ── Minimal HAP / Homebridge mock ─────────────────────────────────────────────

class MockService {
  constructor(name) {
    this.name = name;
    this._ch  = {};
  }
  updateCharacteristic(Char, value) { this._ch[Char.__name || Char] = value; return this; }
  setCharacteristic(Char, value)   { return this.updateCharacteristic(Char, value); }
  get(charName)                    { return this._ch[charName]; }
}

function makeServiceClass(serviceName) {
  const cls = class extends MockService {
    constructor(displayName) { super(displayName || serviceName); }
  };
  Object.defineProperty(cls, 'name', { value: serviceName });
  return cls;
}

function makeChar(name, statics = {}) {
  return { __name: name, ...statics };
}

const Characteristic = {
  Manufacturer:             makeChar('Manufacturer'),
  Model:                    makeChar('Model'),
  SerialNumber:             makeChar('SerialNumber'),
  BatteryLevel:             makeChar('BatteryLevel'),
  StatusLowBattery:         makeChar('StatusLowBattery', {
    BATTERY_LEVEL_LOW:    1,
    BATTERY_LEVEL_NORMAL: 0,
  }),
  ChargingState:            makeChar('ChargingState', {
    CHARGING:     1,
    NOT_CHARGING: 0,
  }),
  On:                       makeChar('On'),
  OutletInUse:              makeChar('OutletInUse'),
  OccupancyDetected:        makeChar('OccupancyDetected', {
    OCCUPANCY_DETECTED:     1,
    OCCUPANCY_NOT_DETECTED: 0,
  }),
  Brightness:               makeChar('Brightness'),
  CurrentAmbientLightLevel: makeChar('CurrentAmbientLightLevel'),
  CurrentTemperature:       makeChar('CurrentTemperature'),
};

const Service = {
  AccessoryInformation: makeServiceClass('AccessoryInformation'),
  Battery:              makeServiceClass('Battery'),
  Outlet:               makeServiceClass('Outlet'),
  OccupancySensor:      makeServiceClass('OccupancySensor'),
  Lightbulb:            makeServiceClass('Lightbulb'),
  LightSensor:          makeServiceClass('LightSensor'),
  TemperatureSensor:    makeServiceClass('TemperatureSensor'),
};

function makeMockAccessory() {
  const serviceMap = new Map();

  function key(ServiceType, subtype) {
    return subtype ? `${ServiceType.name}:${subtype}` : ServiceType.name;
  }

  // Pre-seed AccessoryInformation so the ?. chain in setupPolling works
  const infoSvc = new Service.AccessoryInformation();
  infoSvc.setCharacteristic = () => infoSvc;
  serviceMap.set('AccessoryInformation', infoSvc);

  return {
    _services: serviceMap,
    UUID: 'mock-uuid',

    getService(ServiceType) {
      return serviceMap.get(ServiceType.name) || null;
    },
    getServiceById(ServiceType, subtype) {
      return serviceMap.get(key(ServiceType, subtype)) || null;
    },
    addService(ServiceType, displayName, subtype) {
      const svc = new ServiceType(displayName);
      serviceMap.set(key(ServiceType, subtype), svc);
      return svc;
    },
  };
}

function makeMockApi() {
  return {
    hap: { Characteristic, Service, uuid: { generate: () => 'mock-uuid' } },
    on: jest.fn(),
    registerPlatform:             jest.fn(),
    registerPlatformAccessories:  jest.fn(),
    platformAccessory: class {
      constructor(name, uuid) { Object.assign(this, makeMockAccessory(), { displayName: name, UUID: uuid }); }
    },
  };
}

function makeMockLog() {
  return { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

// ── Flush all pending microtasks ───────────────────────────────────────────────
// poll() is async; after triggering launchCb() we need a few microtask turns
// for the mock queryNUT Promise to resolve and updateCharacteristic to fire.
function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

// ── Load platform + extract class ─────────────────────────────────────────────
function loadPlatform() {
  jest.resetModules();
  jest.mock('../lib/nutClient', () => ({ queryNUT: jest.fn() }));

  let PlatformClass;
  const fakeApi = {
    hap: { Characteristic, Service, uuid: { generate: () => 'mock-uuid' } },
    on: jest.fn(),
    registerPlatform: (_p, _n, Cls) => { PlatformClass = Cls; },
    registerPlatformAccessories: jest.fn(),
    platformAccessory: class {
      constructor(_n, _u) { return makeMockAccessory(); }
    },
  };
  require('../index')(fakeApi);
  return { NUTDashboardPlatform: PlatformClass, queryNUT: require('../lib/nutClient').queryNUT };
}

// ── Standard NUT payloads ─────────────────────────────────────────────────────

const MAINS_DATA = {
  'ups.status':      'OL',
  'battery.charge':  85,
  'battery.runtime': 3600,   // 60 minutes
  'ups.load':        42,
  'input.voltage':   230.5,
  'output.voltage':  230.1,
};

const BATTERY_DATA = {
  'ups.status':      'OB',
  'battery.charge':  40,
  'battery.runtime': 1800,   // 30 minutes
  'ups.load':        35,
  'input.voltage':   0,
  'output.voltage':  229.8,
};

// ── Helper: spin up platform, cache a mock accessory, trigger launch ──────────
async function setupAndPoll(nutData, config = {}) {
  const { NUTDashboardPlatform, queryNUT } = loadPlatform();
  queryNUT.mockResolvedValue(nutData);

  const api = makeMockApi();
  let launchCb;
  api.on.mockImplementation((event, cb) => { if (event === 'didFinishLaunching') launchCb = cb; });

  const platform = new NUTDashboardPlatform(
    makeMockLog(), { host: '127.0.0.1', ups: 'ups', ...config }, api);

  const acc = makeMockAccessory();
  platform.cachedAccessories.set('mock-uuid', acc);

  launchCb();
  await flushPromises();

  return { acc, platform, log: platform.log };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('NUTDashboardPlatform — HomeKit tile services (Feature 1)', () => {

  // ── Service registration ───────────────────────────────────────────────────

  describe('service registration', () => {
    test('all seven services are registered on a fresh accessory', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      const keys = [...acc._services.keys()];
      expect(keys).toContain('Battery');
      expect(keys).toContain('Outlet');
      expect(keys).toContain('OccupancySensor');
      expect(keys).toContain('Lightbulb');
      expect(keys).toContain('LightSensor:input-voltage');
      expect(keys).toContain('LightSensor:output-voltage');
      expect(keys).toContain('TemperatureSensor');
    });
  });

  // ── On-Battery tile (OccupancySensor) ─────────────────────────────────────

  describe('OccupancySensor (on-battery tile)', () => {
    test('OCCUPANCY_NOT_DETECTED when UPS is on mains (OL)', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      expect(acc._services.get('OccupancySensor').get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    });

    test('OCCUPANCY_DETECTED when UPS is on battery (OB)', async () => {
      const { acc } = await setupAndPoll(BATTERY_DATA);
      expect(acc._services.get('OccupancySensor').get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    });
  });

  // ── Load % tile (Lightbulb) ────────────────────────────────────────────────

  describe('Lightbulb (load % tile)', () => {
    test('Brightness equals ups.load rounded to integer', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'ups.load': 42.7 });
      expect(acc._services.get('Lightbulb').get('Brightness')).toBe(43);
    });

    test('On = true when load > 0', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      expect(acc._services.get('Lightbulb').get('On')).toBe(true);
    });

    test('On = false when load is 0', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'ups.load': 0 });
      expect(acc._services.get('Lightbulb').get('On')).toBe(false);
    });

    test('Brightness is clamped to 100 for out-of-range values', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'ups.load': 150 });
      expect(acc._services.get('Lightbulb').get('Brightness')).toBe(100);
    });

    test('Brightness is clamped to 0 for negative values', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'ups.load': -5 });
      expect(acc._services.get('Lightbulb').get('Brightness')).toBe(0);
    });
  });

  // ── Voltage tiles (LightSensor) ────────────────────────────────────────────

  describe('LightSensor — input and output voltage', () => {
    test('input-voltage tile reflects input.voltage', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      expect(acc._services.get('LightSensor:input-voltage').get('CurrentAmbientLightLevel'))
        .toBe(230.5);
    });

    test('output-voltage tile reflects output.voltage', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      expect(acc._services.get('LightSensor:output-voltage').get('CurrentAmbientLightLevel'))
        .toBe(230.1);
    });

    test('voltage is clamped to minimum 0.0001 (HAP lower bound for lux)', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'input.voltage': 0 });
      expect(acc._services.get('LightSensor:input-voltage').get('CurrentAmbientLightLevel'))
        .toBe(0.0001);
    });

    test('voltage is clamped to maximum 100000 (HAP upper bound for lux)', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'output.voltage': 999999 });
      expect(acc._services.get('LightSensor:output-voltage').get('CurrentAmbientLightLevel'))
        .toBe(100000);
    });

    test('input-voltage tile is not updated when variable is absent from NUT', async () => {
      const data = { ...MAINS_DATA };
      delete data['input.voltage'];
      const { acc } = await setupAndPoll(data);
      expect(acc._services.get('LightSensor:input-voltage').get('CurrentAmbientLightLevel'))
        .toBeUndefined();
    });

    test('output-voltage tile is not updated when variable is absent from NUT', async () => {
      const data = { ...MAINS_DATA };
      delete data['output.voltage'];
      const { acc } = await setupAndPoll(data);
      expect(acc._services.get('LightSensor:output-voltage').get('CurrentAmbientLightLevel'))
        .toBeUndefined();
    });
  });

  // ── Runtime tile (TemperatureSensor) ──────────────────────────────────────

  describe('TemperatureSensor (runtime-in-minutes tile)', () => {
    test('CurrentTemperature = battery.runtime / 60', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'battery.runtime': 3600 });
      expect(acc._services.get('TemperatureSensor').get('CurrentTemperature')).toBe(60);
    });

    test('30-minute runtime → CurrentTemperature 30', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'battery.runtime': 1800 });
      expect(acc._services.get('TemperatureSensor').get('CurrentTemperature')).toBe(30);
    });

    test('runtime is clamped to 100 (HAP CurrentTemperature max)', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'battery.runtime': 36000 }); // 600 min
      expect(acc._services.get('TemperatureSensor').get('CurrentTemperature')).toBe(100);
    });

    test('runtime tile is not updated when battery.runtime is absent', async () => {
      const data = { ...MAINS_DATA };
      delete data['battery.runtime'];
      const { acc } = await setupAndPoll(data);
      expect(acc._services.get('TemperatureSensor').get('CurrentTemperature'))
        .toBeUndefined();
    });
  });

  // ── Existing services — regression guard ──────────────────────────────────

  describe('Battery and Outlet services (regression)', () => {
    test('BatteryLevel is set from battery.charge', async () => {
      const { acc } = await setupAndPoll({ ...MAINS_DATA, 'battery.charge': 72 });
      expect(acc._services.get('Battery').get('BatteryLevel')).toBe(72);
    });

    test('StatusLowBattery is BATTERY_LEVEL_LOW when charge < threshold', async () => {
      const { acc } = await setupAndPoll(
        { ...MAINS_DATA, 'battery.charge': 15 },
        { lowBatteryThreshold: 20 }
      );
      expect(acc._services.get('Battery').get('StatusLowBattery'))
        .toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    });

    test('Outlet On = true when UPS is on mains', async () => {
      const { acc } = await setupAndPoll(MAINS_DATA);
      expect(acc._services.get('Outlet').get('On')).toBe(true);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('poll error handling', () => {
    test('logs an error and does not throw when queryNUT rejects', async () => {
      const { NUTDashboardPlatform, queryNUT } = loadPlatform();
      queryNUT.mockRejectedValue(new Error('Connection refused'));

      const log = makeMockLog();
      const api = makeMockApi();
      let launchCb;
      api.on.mockImplementation((e, cb) => { if (e === 'didFinishLaunching') launchCb = cb; });

      const platform = new NUTDashboardPlatform(log, { ups: 'ups' }, api);
      const acc = makeMockAccessory();
      platform.cachedAccessories.set('mock-uuid', acc);

      // launchCb() returns undefined — don't wrap in .resolves
      launchCb();
      await flushPromises();

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('NUT query failed')
      );
    });

    test('appends guidance to the log line when the rejection carries it (NUTQueryError shape)', async () => {
      const { NUTDashboardPlatform, queryNUT } = loadPlatform();
      const nutErr = new Error('DATA-STALE');
      nutErr.code = 'DATA-STALE';
      nutErr.category = 'stale-data';
      nutErr.retryable = true;
      nutErr.guidance = 'Check the driver status and USB connectivity.';
      queryNUT.mockRejectedValue(nutErr);

      const log = makeMockLog();
      const api = makeMockApi();
      let launchCb;
      api.on.mockImplementation((e, cb) => { if (e === 'didFinishLaunching') launchCb = cb; });

      const platform = new NUTDashboardPlatform(log, { ups: 'ups' }, api);
      const acc = makeMockAccessory();
      platform.cachedAccessories.set('mock-uuid', acc);

      launchCb();
      await flushPromises();

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('Check the driver status and USB connectivity.')
      );
    });

    test('does not append anything extra when the rejection has no guidance (plain Error)', async () => {
      const { NUTDashboardPlatform, queryNUT } = loadPlatform();
      queryNUT.mockRejectedValue(new Error('Connection refused'));

      const log = makeMockLog();
      const api = makeMockApi();
      let launchCb;
      api.on.mockImplementation((e, cb) => { if (e === 'didFinishLaunching') launchCb = cb; });

      const platform = new NUTDashboardPlatform(log, { ups: 'ups' }, api);
      const acc = makeMockAccessory();
      platform.cachedAccessories.set('mock-uuid', acc);

      launchCb();
      await flushPromises();

      expect(log.error).toHaveBeenCalledWith(
        '[ups] NUT query failed: Connection refused'
      );
    });

    test('protects telemetry integrity: a failed poll writes no history point and does not update tiles', async () => {
      const { NUTDashboardPlatform, queryNUT } = loadPlatform();
      queryNUT.mockRejectedValue(Object.assign(new Error('DATA-STALE'), {
        code: 'DATA-STALE', category: 'stale-data', retryable: true,
      }));

      // Spy on the underlying store writers rather than inspecting real files —
      // storagePaths.js's cross-version migration can pull unrelated data files
      // into whatever storage path this test uses, which would make a raw
      // file-existence check unreliable. Requiring these AFTER loadPlatform()'s
      // jest.resetModules() gets the exact module instances index.js uses.
      const RingBuffer = require('../lib/ringBuffer');
      const DailyLog    = require('../lib/dailyLog');
      const OutageLog   = require('../lib/outageLog');
      const pushSpy   = jest.spyOn(RingBuffer.prototype, 'push');
      const appendSpy = jest.spyOn(DailyLog.prototype, 'append');
      const recordSpy = jest.spyOn(OutageLog.prototype, 'record');

      const log = makeMockLog();
      const api = makeMockApi();
      let launchCb;
      api.on.mockImplementation((e, cb) => { if (e === 'didFinishLaunching') launchCb = cb; });

      const platform = new NUTDashboardPlatform(log, { ups: 'ups' }, api);
      const acc = makeMockAccessory();
      platform.cachedAccessories.set('mock-uuid', acc);

      launchCb();
      await flushPromises();

      // A failed poll must never produce an all-null telemetry point (see
      // issue #237) — none of the three stores should have been written to.
      expect(pushSpy).not.toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
      expect(recordSpy).not.toHaveBeenCalled();

      // Tiles never had .update() called, so no HomeKit characteristic was
      // pushed to a blank/unknown value either.
      expect(acc.getService(Service.Battery).get('BatteryLevel')).toBeUndefined();

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('NUT query failed'));
    });

    test('recovery: once the NUT query starts succeeding again, a real (non-null) history point is written', async () => {
      const { NUTDashboardPlatform, queryNUT } = loadPlatform();
      queryNUT.mockRejectedValueOnce(Object.assign(new Error('DATA-STALE'), {
        code: 'DATA-STALE', category: 'stale-data', retryable: true,
      }));
      queryNUT.mockResolvedValueOnce(MAINS_DATA);

      const RingBuffer = require('../lib/ringBuffer');
      const pushSpy = jest.spyOn(RingBuffer.prototype, 'push');

      const api = makeMockApi();
      let launchCb;
      api.on.mockImplementation((e, cb) => { if (e === 'didFinishLaunching') launchCb = cb; });
      const platform = new NUTDashboardPlatform(makeMockLog(), { ups: 'ups' }, api);
      platform.cachedAccessories.set('mock-uuid', makeMockAccessory());

      // First poll (immediate, on construction) fails — nothing pushed.
      launchCb();
      await flushPromises();
      expect(pushSpy).not.toHaveBeenCalled();

      // Re-run the same self-scheduling poll loop's tick manually (setTimeout
      // is stubbed out for this whole suite) to simulate the driver recovering
      // in time for the next scheduled poll.
      const stores = { ringBuf: platform.ringBuffers.get('ups'), dailyLog: platform.dailyLogs.get('ups'), outageLog: platform.outageLogs.get('ups') };
      const tiles  = platform._createTiles(makeMockAccessory(), 'ups');
      platform._startPollLoop('ups', tiles, stores);
      await flushPromises();

      expect(pushSpy).toHaveBeenCalledTimes(1);
      const point = pushSpy.mock.calls[0][0];
      expect(point.bat).toBe(85);
      expect(point.load).toBe(42);
      expect(point.inV).toBe(230.5);
    });
  });

  describe('storage path resolution', () => {
    test('prefers api.user.storagePath() when available', () => {
      const { NUTDashboardPlatform } = loadPlatform();
      const api = makeMockApi();
      api.user = { storagePath: () => '/custom/hb-storage' };
      const platform = new NUTDashboardPlatform(makeMockLog(), { ups: 'ups' }, api);
      expect(platform.storagePath).toBe('/custom/hb-storage');
    });

    test('falls back when api.user.storagePath is unavailable', () => {
      const { NUTDashboardPlatform } = loadPlatform();
      const api = makeMockApi(); // no user.storagePath
      const platform = new NUTDashboardPlatform(makeMockLog(), { ups: 'ups' }, api);
      expect(typeof platform.storagePath).toBe('string');
      expect(platform.storagePath.length).toBeGreaterThan(0);
    });
  });

  describe('standalonePort validation', () => {
    function makePlatform(config) {
      const { NUTDashboardPlatform } = loadPlatform();
      const api = makeMockApi();
      const log = makeMockLog();
      const platform = new NUTDashboardPlatform(log, { host: '127.0.0.1', ups: 'ups', ...config }, api);
      return { platform, log };
    }

    test('starts the dashboard server for a valid port', () => {
      const { platform, log } = makePlatform({ standalonePort: 8581 });
      expect(platform._dashboardServer).not.toBeNull();
      expect(log.error).not.toHaveBeenCalled();
    });

    test('rejects an out-of-range port and does not start the server', () => {
      const { platform, log } = makePlatform({ standalonePort: 70000 });
      expect(platform._dashboardServer).toBeNull();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid standalonePort'));
    });

    test('rejects a non-integer port', () => {
      const { platform, log } = makePlatform({ standalonePort: 'abc' });
      expect(platform._dashboardServer).toBeNull();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid standalonePort'));
    });

    test('leaves the server disabled when no port is set', () => {
      const { platform, log } = makePlatform({});
      expect(platform._dashboardServer).toBeNull();
      expect(log.error).not.toHaveBeenCalled();
    });
  });

  describe('shutdown cleanup', () => {
    function makePlatform(config) {
      const { NUTDashboardPlatform } = loadPlatform();
      const api = makeMockApi();
      const log = makeMockLog();
      const platform = new NUTDashboardPlatform(log, { host: '127.0.0.1', ups: 'ups', ...config }, api);
      return { platform, api, log };
    }

    test('registers a shutdown handler', () => {
      const { api } = makePlatform({});
      expect(api.on).toHaveBeenCalledWith('shutdown', expect.any(Function));
    });

    test('clears pending poll timers', () => {
      const { platform } = makePlatform({});
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      platform._pollTimers.set('ups', 1);
      platform._pollTimers.set('ups2', 2);
      platform._shutdown();
      expect(clearSpy).toHaveBeenCalledTimes(2);
      expect(platform._pollTimers.size).toBe(0);
    });

    test('stops the standalone dashboard server when running', () => {
      const { platform } = makePlatform({ standalonePort: 8581 });
      const server = platform._dashboardServer;
      expect(server).not.toBeNull();
      platform._shutdown();
      expect(server.stop).toHaveBeenCalled();
      expect(platform._dashboardServer).toBeNull();
    });

    test('is a no-op when no dashboard server is running', () => {
      const { platform } = makePlatform({});
      expect(platform._dashboardServer).toBeNull();
      expect(() => platform._shutdown()).not.toThrow();
    });
  });

  describe('pollInterval validation', () => {
    function makePlatform(config) {
      const { NUTDashboardPlatform } = loadPlatform();
      const api = makeMockApi();
      const log = makeMockLog();
      const platform = new NUTDashboardPlatform(log, { host: '127.0.0.1', ups: 'ups', ...config }, api);
      return { platform, log };
    }

    test('uses a valid interval as given', () => {
      const { platform, log } = makePlatform({ pollInterval: 10 });
      expect(platform.pollSec).toBe(10);
      expect(platform.pollMs).toBe(10000);
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('floors a fractional interval', () => {
      const { platform } = makePlatform({ pollInterval: 5.9 });
      expect(platform.pollSec).toBe(5);
    });

    test('defaults to 30s when omitted (no warning)', () => {
      const { platform, log } = makePlatform({});
      expect(platform.pollSec).toBe(30);
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('falls back to 30s and warns on a negative interval', () => {
      const { platform, log } = makePlatform({ pollInterval: -5 });
      expect(platform.pollSec).toBe(30);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid pollInterval'));
    });

    test('falls back to 30s and warns on a non-numeric interval', () => {
      const { platform, log } = makePlatform({ pollInterval: 'fast' });
      expect(platform.pollSec).toBe(30);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid pollInterval'));
    });

    test('falls back to 30s and warns on a sub-1s interval', () => {
      const { platform, log } = makePlatform({ pollInterval: 0.5 });
      expect(platform.pollSec).toBe(30);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid pollInterval'));
    });
  });

});
