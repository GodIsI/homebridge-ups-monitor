'use strict';

/**
 * lib/tiles/inputVoltageTile.js
 *
 * Input Voltage tile — displays the AC mains voltage feeding the UPS.
 *
 * HAP service: LightSensor (subtype 'input-voltage')
 * Characteristic: CurrentAmbientLightLevel (range 0.0001–100000 lux)
 *
 * We use LightSensor rather than TemperatureSensor because
 * CurrentTemperature caps at 100°C — EU 230 V and US 120 V both exceed that.
 * CurrentAmbientLightLevel has no such ceiling for realistic AC voltages.
 *
 * The tile is not updated when input.voltage is absent from the NUT response
 * (e.g. the UPS model does not expose it).
 */

/** HAP lower bound for CurrentAmbientLightLevel */
const LUX_MIN = 0.0001;
/** HAP upper bound for CurrentAmbientLightLevel */
const LUX_MAX = 100000;

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupInputVoltageTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getServiceById(Service.LightSensor, 'input-voltage');
  if (!svc) {
    svc = accessory.addService(
      Service.LightSensor, `${upsName} Input Voltage`, 'input-voltage');
  }

  return {
    update(data) {
      const v = data['input.voltage'];
      if (v === undefined) return;
      svc.updateCharacteristic(
        Characteristic.CurrentAmbientLightLevel,
        Math.max(LUX_MIN, Math.min(LUX_MAX, v))
      );
    },
  };
};
