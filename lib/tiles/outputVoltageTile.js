'use strict';

/**
 * lib/tiles/outputVoltageTile.js
 *
 * Output Voltage tile — displays the AC voltage the UPS is supplying to
 * connected devices.
 *
 * HAP service: LightSensor (subtype 'output-voltage')
 * Characteristic: CurrentAmbientLightLevel (range 0.0001–100000 lux)
 *
 * Same rationale as inputVoltageTile — LightSensor avoids the 100°C ceiling
 * of CurrentTemperature for voltages above 100 V.
 */

const LUX_MIN = 0.0001;
const LUX_MAX = 100000;

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupOutputVoltageTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getServiceById(Service.LightSensor, 'output-voltage');
  if (!svc) {
    svc = accessory.addService(
      Service.LightSensor, `${upsName} Output Voltage`, 'output-voltage');
  }

  return {
    update(data) {
      const v = data['output.voltage'];
      if (v === undefined) return;
      svc.updateCharacteristic(
        Characteristic.CurrentAmbientLightLevel,
        Math.max(LUX_MIN, Math.min(LUX_MAX, v))
      );
    },
  };
};
