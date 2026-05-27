'use strict';

const { api, Service, makeMockAccessory } = require('./helpers');
const setupOutputVoltageTile = require('../../lib/tiles/outputVoltageTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupOutputVoltageTile(acc, api, 'ups');
  const svc  = acc.svc(Service.LightSensor, 'output-voltage');
  return { tile, svc };
}

describe('outputVoltageTile', () => {
  describe('service registration', () => {
    test('creates LightSensor with subtype output-voltage', () => {
      const acc = makeMockAccessory();
      setupOutputVoltageTile(acc, api, 'ups');
      expect(acc.svc(Service.LightSensor, 'output-voltage')).toBeTruthy();
    });
  });

  describe('CurrentAmbientLightLevel', () => {
    test('reflects output.voltage directly', () => {
      const { tile, svc } = make();
      tile.update({ 'output.voltage': 230.1 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(230.1);
    });

    test('clamps to LUX_MIN (0.0001) when voltage is 0', () => {
      const { tile, svc } = make();
      tile.update({ 'output.voltage': 0 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(0.0001);
    });

    test('clamps to LUX_MAX (100000) for extreme values', () => {
      const { tile, svc } = make();
      tile.update({ 'output.voltage': 200000 }, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBe(100000);
    });

    test('does not update when output.voltage is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('CurrentAmbientLightLevel')).toBeUndefined();
    });

    test('independent of input-voltage tile on the same accessory', () => {
      // Both tile types can coexist by subtype
      const acc = makeMockAccessory();
      const inTile  = require('../../lib/tiles/inputVoltageTile')(acc, api, 'ups');
      const outTile = setupOutputVoltageTile(acc, api, 'ups');
      inTile.update(  { 'input.voltage': 120 }, {});
      outTile.update( { 'output.voltage': 119 }, {});
      expect(acc.svc(Service.LightSensor, 'input-voltage').get('CurrentAmbientLightLevel')).toBe(120);
      expect(acc.svc(Service.LightSensor, 'output-voltage').get('CurrentAmbientLightLevel')).toBe(119);
    });
  });
});
