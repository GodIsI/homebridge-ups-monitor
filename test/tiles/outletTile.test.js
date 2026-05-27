'use strict';

const { api, Characteristic, Service, makeMockAccessory } = require('./helpers');
const setupOutletTile = require('../../lib/tiles/outletTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupOutletTile(acc, api, 'ups');
  const svc  = acc.svc(Service.Outlet);
  return { tile, svc };
}

describe('outletTile', () => {
  describe('service registration', () => {
    test('creates Outlet service on a fresh accessory', () => {
      const acc = makeMockAccessory();
      setupOutletTile(acc, api, 'ups');
      expect(acc.svc(Service.Outlet)).toBeTruthy();
    });
  });

  describe('On', () => {
    test('On = true when UPS is on mains (onLine)', () => {
      const { tile, svc } = make();
      tile.update({}, { onLine: true, onBattery: false });
      expect(svc.get('On')).toBe(true);
    });

    test('On = true when UPS is on battery (onBattery)', () => {
      const { tile, svc } = make();
      tile.update({}, { onLine: false, onBattery: true });
      expect(svc.get('On')).toBe(true);
    });

    test('On = false when both flags are false', () => {
      const { tile, svc } = make();
      tile.update({}, { onLine: false, onBattery: false });
      expect(svc.get('On')).toBe(false);
    });
  });

  describe('OutletInUse', () => {
    test('OutletInUse = true when load > 0', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 42 }, { onLine: true });
      expect(svc.get('OutletInUse')).toBe(true);
    });

    test('OutletInUse = false when load is 0', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 0 }, { onLine: true });
      expect(svc.get('OutletInUse')).toBe(false);
    });

    test('OutletInUse = false when load is absent', () => {
      const { tile, svc } = make();
      tile.update({}, { onLine: true });
      expect(svc.get('OutletInUse')).toBe(false);
    });
  });
});
