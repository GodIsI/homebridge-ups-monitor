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

// ── Stop setInterval from leaking open handles across tests ───────────────────
// The platform calls setInterval(poll, pollMs) in setupPolling().  We replace
// it with a no-op mock so Jest can exit cleanly.  Individual tests call poll()
// synchronously via the first `poll()` at the end of setupPolling, so timers
// are not needed for our assertions.
beforeEach(() => {
  jest.spyOn(global, 'setInterval').mockReturnValue(1);
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
      constructor(n, u) { return makeMockAccessory(); }
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
  });

});
