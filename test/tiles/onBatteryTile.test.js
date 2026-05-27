'use strict';

const { api, Characteristic, Service, makeMockAccessory } = require('./helpers');
const setupOnBatteryTile = require('../../lib/tiles/onBatteryTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupOnBatteryTile(acc, api, 'ups');
  const svc  = acc.svc(Service.OccupancySensor);
  return { tile, svc };
}

describe('onBatteryTile', () => {
  describe('service registration', () => {
    test('creates OccupancySensor service on a fresh accessory', () => {
      const acc = makeMockAccessory();
      setupOnBatteryTile(acc, api, 'ups');
      expect(acc.svc(Service.OccupancySensor)).toBeTruthy();
    });
  });

  describe('OccupancyDetected', () => {
    test('OCCUPANCY_NOT_DETECTED when on mains', () => {
      const { tile, svc } = make();
      tile.update({}, { onBattery: false });
      expect(svc.get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    });

    test('OCCUPANCY_DETECTED when on battery', () => {
      const { tile, svc } = make();
      tile.update({}, { onBattery: true });
      expect(svc.get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    });

    test('transitions correctly between mains and battery', () => {
      const { tile, svc } = make();
      tile.update({}, { onBattery: false });
      expect(svc.get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      tile.update({}, { onBattery: true });
      expect(svc.get('OccupancyDetected'))
        .toBe(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    });
  });
});
