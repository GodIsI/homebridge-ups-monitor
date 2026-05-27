'use strict';

/**
 * lib/tiles/batteryTile.js
 *
 * Battery service — shows battery %, charging state, and low-battery alert.
 *
 * HAP service: Battery
 * Characteristics updated:
 *   BatteryLevel       — battery.charge (0–100)
 *   ChargingState      — CHARGING / NOT_CHARGING
 *   StatusLowBattery   — BATTERY_LEVEL_LOW / BATTERY_LEVEL_NORMAL
 */

/**
 * @param {object} accessory          Homebridge platformAccessory
 * @param {object} api                Homebridge API
 * @param {string} upsName            UPS identifier (used in display name)
 * @param {object} [opts]
 * @param {number} [opts.lowBatThreshold=20]  % below which StatusLowBattery fires
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupBatteryTile(accessory, api, upsName, opts = {}) {
  const { Characteristic, Service } = api.hap;
  const lowBatThreshold = opts.lowBatThreshold ?? 20;

  let svc = accessory.getService(Service.Battery);
  if (!svc) {
    svc = accessory.addService(Service.Battery, `${upsName} Battery`);
  }

  return {
    update(data, flags) {
      const charge = data['battery.charge'];

      if (charge !== undefined) {
        svc.updateCharacteristic(
          Characteristic.BatteryLevel,
          Math.min(100, Math.max(0, Math.round(charge)))
        );
        svc.updateCharacteristic(
          Characteristic.StatusLowBattery,
          charge < lowBatThreshold
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
        );
      }

      svc.updateCharacteristic(
        Characteristic.ChargingState,
        flags.charging
          ? Characteristic.ChargingState.CHARGING
          : Characteristic.ChargingState.NOT_CHARGING
      );
    },
  };
};
