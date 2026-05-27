'use strict';

const { api, Service, makeMockAccessory } = require('./helpers');
const setupInputVoltageTile = require('../../lib/tiles/inputVoltageTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupInputVoltageTile(acc, api, 'ups');
  const svc  = acc.svc(Service.LightSensor, 'input-voltage');
  return { tile, svc };
}

describe('inputVoltageTile', () => {
  describe('service registration', () => {
    test('creates LightSensor with subtype input-voltage', () => {
      const acc = makeMockAccessory();
      setupInputVoltageTile(acc, api, 'ups');
      expect(acc.svc(Service.LightSensor, 'input-voltage')).toBeTruthy();
    });
  });

  describe('CurrentAmbientLightLevel', () => {
    test('reflects input.voltage directly', () => {
      const { tile, svc } = make();
      tile.update({ 'input.voltage': 230.5 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(230.5);
    });

    test('clamps to LUX_MIN (0.0001) when voltage is 0', () => {
      const { tile, svc } = make();
      tile.update({ 'input.voltage': 0 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(0.0001);
    });

    test('clamps to LUX_MAX (100000) for extreme values', () => {
      const { tile, svc } = make();
      tile.update({ 'input.voltage': 999999 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(100000);
    });

    test('does not update when input.voltage is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBeUndefined();
    });

    test('120 V is passed through unmodified', () => {
      const { tile, svc } = make();
      tile.update({ 'input.voltage': 120 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(120);
    });
  });
});
