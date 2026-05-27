'use strict';

/**
 * lib/tiles/loadTile.js
 *
 * Load % tile — shows how heavily the UPS is loaded as a Lightbulb brightness.
 *
 * HAP service: Lightbulb
 * Characteristics updated:
 *   On         — true when load > 0 (devices are drawing power)
 *   Brightness — ups.load clamped to 0–100
 */

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupLoadTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getService(Service.Lightbulb);
  if (!svc) {
    svc = accessory.addService(Service.Lightbulb, `${upsName} Load`);
  }

  return {
    update(data) {
      const load = Math.min(100, Math.max(0, Math.round(data['ups.load'] || 0)));
      svc.updateCharacteristic(Characteristic.On,         load > 0);
      svc.updateCharacteristic(Characteristic.Brightness, load);
    },
  };
};
