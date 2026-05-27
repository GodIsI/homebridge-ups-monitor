'use strict';

const { api, Characteristic, Service, makeMockAccessory } = require('./helpers');
const setupBatteryTile = require('../../lib/tiles/batteryTile');

function make(opts) {
  const acc = makeMockAccessory();
  const tile = setupBatteryTile(acc, api, 'ups', opts);
  const svc  = acc.svc(Service.Battery);
  return { tile, svc };
}

describe('batteryTile', () => {
  describe('service registration', () => {
    test('creates Battery service on a fresh accessory', () => {
      const acc = makeMockAccessory();
      setupBatteryTile(acc, api, 'ups');
      expect(acc.svc(Service.Battery)).toBeTruthy();
    });

    test('reuses existing Battery service on a cached accessory', () => {
      const acc = makeMockAccessory();
      const existing = acc.addService(Service.Battery, 'ups Battery');
      setupBatteryTile(acc, api, 'ups');
      expect(acc.svc(Service.Battery)).toBe(existing);
    });
  });

  describe('BatteryLevel', () => {
    test('sets BatteryLevel from battery.charge', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 85 }, {});
      expect(svc.get('BatteryLevel')).toBe(85);
    });

    test('rounds fractional values', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 84.6 }, {});
      expect(svc.get('BatteryLevel')).toBe(85);
    });

    test('clamps to 0 for negative values', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': -5 }, {});
      expect(svc.get('BatteryLevel')).toBe(0);
    });

    test('clamps to 100 for over-range values', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 110 }, {});
      expect(svc.get('BatteryLevel')).toBe(100);
    });

    test('skips BatteryLevel update when battery.charge is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('BatteryLevel')).toBeUndefined();
    });
  });

  describe('StatusLowBattery', () => {
    test('BATTERY_LEVEL_LOW when charge < threshold (default 20)', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 15 }, {});
      expect(svc.get('StatusLowBattery'))
        .toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    });

    test('BATTERY_LEVEL_NORMAL when charge >= threshold', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 20 }, {});
      expect(svc.get('StatusLowBattery'))
        .toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    });

    test('respects a custom lowBatThreshold', () => {
      const { tile, svc } = make({ lowBatThreshold: 30 });
      tile.update({ 'battery.charge': 25 }, {});
      expect(svc.get('StatusLowBattery'))
        .toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    });
  });

  describe('ChargingState', () => {
    test('CHARGING when flags.charging is true', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 50 }, { charging: true });
      expect(svc.get('ChargingState')).toBe(Characteristic.ChargingState.CHARGING);
    });

    test('NOT_CHARGING when flags.charging is false', () => {
      const { tile, svc } = make();
      tile.update({ 'battery.charge': 50 }, { charging: false });
      expect(svc.get('ChargingState')).toBe(Characteristic.ChargingState.NOT_CHARGING);
    });
  });
});
