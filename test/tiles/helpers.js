'use strict';

/**
 * test/tiles/helpers.js
 *
 * Shared HAP mock utilities for tile unit tests.
 * Each tile test requires only this file — no Homebridge runtime needed.
 */

/** Record characteristic updates keyed by __name. */
class MockService {
  constructor() { this._ch = {}; }
  updateCharacteristic(char, value) { this._ch[char.__name] = value; return this; }
  setCharacteristic(char, value)   { return this.updateCharacteristic(char, value); }
  get(name)                        { return this._ch[name]; }
}

function makeChar(name, statics = {}) {
  return { __name: name, ...statics };
}

/** Minimal HAP Characteristic stubs. */
const Characteristic = {
  BatteryLevel:             makeChar('BatteryLevel'),
  StatusLowBattery:         makeChar('StatusLowBattery', { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 }),
  ChargingState:            makeChar('ChargingState',    { CHARGING: 1, NOT_CHARGING: 0 }),
  On:                       makeChar('On'),
  OutletInUse:              makeChar('OutletInUse'),
  OccupancyDetected:        makeChar('OccupancyDetected', { OCCUPANCY_DETECTED: 1, OCCUPANCY_NOT_DETECTED: 0 }),
  Brightness:               makeChar('Brightness'),
  CurrentAmbientLightLevel: makeChar('CurrentAmbientLightLevel'),
  CurrentTemperature:       makeChar('CurrentTemperature'),
  Manufacturer:             makeChar('Manufacturer'),
  Model:                    makeChar('Model'),
  SerialNumber:             makeChar('SerialNumber'),
};

function makeServiceClass(name) {
  const cls = class extends MockService {};
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

/** Minimal HAP Service stubs — each is a distinct class. */
const Service = {
  Battery:           makeServiceClass('Battery'),
  Outlet:            makeServiceClass('Outlet'),
  OccupancySensor:   makeServiceClass('OccupancySensor'),
  Lightbulb:         makeServiceClass('Lightbulb'),
  LightSensor:       makeServiceClass('LightSensor'),
  TemperatureSensor: makeServiceClass('TemperatureSensor'),
  AccessoryInformation: makeServiceClass('AccessoryInformation'),
};

/** Minimal api stub. */
const api = { hap: { Characteristic, Service } };

/**
 * Build a mock accessory that tracks services by (ServiceType.name, subtype).
 * Returns the accessory plus a helper to retrieve a service by class.
 */
function makeMockAccessory() {
  const map = new Map();

  function key(ServiceType, subtype) {
    return subtype ? `${ServiceType.name}:${subtype}` : ServiceType.name;
  }

  const accessory = {
    _map: map,
    getService(ServiceType)             { return map.get(key(ServiceType)) || null; },
    getServiceById(ServiceType, sub)    { return map.get(key(ServiceType, sub)) || null; },
    addService(ServiceType, _name, sub) {
      const svc = new ServiceType();
      map.set(key(ServiceType, sub), svc);
      return svc;
    },
    svc(ServiceType, sub) { return map.get(key(ServiceType, sub)); },
  };

  return accessory;
}

module.exports = { api, Characteristic, Service, makeMockAccessory };
