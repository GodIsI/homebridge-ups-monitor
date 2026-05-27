'use strict';

const { api, Service, makeMockAccessory } = require('./helpers');
const setupRuntimeTile = require('../../lib/tiles/runtimeTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupRuntimeTile(acc, api, 'ups');
  const svc  = acc.svc(Service.TemperatureSensor);
  return { tile, svc };
}

describe('runtimeTile', () => {
  describe('service registration', () => {
    test('creates TemperatureSensor service on a fresh accessory', () => {
      const acc = makeMockAccessory();
      setupRuntimeTile(acc, api, 'ups');
      expect(acc.svc(Service.TemperatureSensor)).toBeTruthy();
    });
  });

  describe('CurrentTemperature (runtime in minutes)', () => {
    test('converts seconds to minutes (3600 s → 60)', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.runtime': 3600 }, {});
      expect(svc.get('CurrentTemperature')).toBe(60);
    });

    test('converts seconds to minutes (1800 s → 30)', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.runtime': 1800 }, {});
      expect(svc.get('CurrentTemperature')).toBe(30);
    });

    test('fractional minutes are preserved', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.runtime': 90 }, {}); // 1.5 min
      expect(svc.get('CurrentTemperature')).toBe(1.5);
    });

    test('clamps to 100 (HAP max) for long runtimes', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.runtime': 36000 }, {}); // 600 min
      expect(svc.get('CurrentTemperature')).toBe(100);
    });

    test('does not update when battery.runtime is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('CurrentTemperature')).toBeUndefined();
    });

    test('runtime of 0 s → 0 min', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.runtime': 0 }, {});
      expect(svc.get('CurrentTemperature')).toBe(0);
    });
  });
});
