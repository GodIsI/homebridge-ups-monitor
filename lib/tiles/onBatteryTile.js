'use strict';

/**
 * lib/tiles/onBatteryTile.js
 *
 * On-Battery alert tile — fires when the UPS switches from mains to battery.
 * Useful for HomeKit automations (e.g. send a notification when power fails).
 *
 * HAP service: OccupancySensor
 * Characteristics updated:
 *   OccupancyDetected — OCCUPANCY_DETECTED (1) on battery, NOT_DETECTED (0) on mains
 */

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupOnBatteryTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getService(Service.OccupancySensor);
  if (!svc) {
    svc = accessory.addService(Service.OccupancySensor, `${upsName} On Battery`);
  }

  return {
    update(_data, flags) {
      svc.updateCharacteristic(
        Characteristic.OccupancyDetected,
        flags.onBattery
          ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      );
    },
  };
};
