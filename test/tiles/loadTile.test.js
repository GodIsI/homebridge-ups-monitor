'use strict';

const { api, Service, makeMockAccessory } = require('./helpers');
const setupLoadTile = require('../../lib/tiles/loadTile');

function make() {
  const acc = makeMockAccessory();
  const tile = setupLoadTile(acc, api, 'ups');
  const svc  = acc.svc(Service.Lightbulb);
  return { tile, svc };
}

describe('loadTile', () => {
  describe('service registration', () => {
    test('creates Lightbulb service on a fresh accessory', () => {
      const acc = makeMockAccessory();
      setupLoadTile(acc, api, 'ups');
      expect(acc.svc(Service.Lightbulb)).toBeTruthy();
    });
  });

  describe('Brightness', () => {
    test('Brightness equals ups.load rounded', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 42.4 }, {});
      expect(svc.get('Brightness')).toBe(42);
    });

    test('rounds up at .5', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 42.5 }, {});
      expect(svc.get('Brightness')).toBe(43);
    });

    test('clamps to 0 for negative values', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': -10 }, {});
      expect(svc.get('Brightness')).toBe(0);
    });

    test('clamps to 100 for over-range values', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 150 }, {});
      expect(svc.get('Brightness')).toBe(100);
    });

    test('defaults to 0 when ups.load is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('Brightness')).toBe(0);
    });
  });

  describe('On', () => {
    test('On = true when load > 0', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 1 }, {});
      expect(svc.get('On')).toBe(true);
    });

    test('On = false when load is 0', () => {
      const { tile, svc } = make();
      tile.update({ 'ups.load': 0 }, {});
      expect(svc.get('On')).toBe(false);
    });

    test('On = false when ups.load is absent', () => {
      const { tile, svc } = make();
      tile.update({}, {});
      expect(svc.get('On')).toBe(false);
    });
  });
});
