'use strict';

/**
 * lib/tiles/runtimeTile.js
 *
 * Runtime tile — shows remaining battery runtime in minutes.
 *
 * HAP service: TemperatureSensor
 * Characteristic: CurrentTemperature (range −270 to 100°C)
 *
 * battery.runtime arrives from NUT in seconds; we divide by 60 to get minutes.
 * A home UPS at moderate load typically provides 5–90 minutes of runtime,
 * which fits within the −270 to 100°C valid range.  Values above 100 min are
 * clamped to 100 to stay within the HAP characteristic ceiling.
 *
 * The tile is not updated when battery.runtime is absent from the NUT response.
 */

/** HAP CurrentTemperature maximum value */
const TEMP_MAX = 100;
/** HAP CurrentTemperature minimum value */
const TEMP_MIN = -270;

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupRuntimeTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getService(Service.TemperatureSensor);
  if (!svc) {
    svc = accessory.addService(
      Service.TemperatureSensor, `${upsName} Runtime (min)`);
  }

  return {
    update(data) {
      const runtimeSec = data['battery.runtime'];
      if (runtimeSec === undefined) return;
      const minutes = Math.min(TEMP_MAX, Math.max(TEMP_MIN, runtimeSec / 60));
      svc.updateCharacteristic(Characteristic.CurrentTemperature, minutes);
    },
  };
};
