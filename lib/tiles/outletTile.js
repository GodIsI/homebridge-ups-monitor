'use strict';

/**
 * lib/tiles/outletTile.js
 *
 * Outlet service — indicates the UPS is supplying power and whether any load
 * is drawing from it.
 *
 * HAP service: Outlet
 * Characteristics updated:
 *   On           — true when the UPS is either on mains or on battery (i.e. alive)
 *   OutletInUse  — true when ups.load > 0
 */

/**
 * @param {object} accessory  Homebridge platformAccessory
 * @param {object} api        Homebridge API
 * @param {string} upsName    UPS identifier
 * @returns {{ update(data: object, flags: object): void }}
 */
module.exports = function setupOutletTile(accessory, api, upsName) {
  const { Characteristic, Service } = api.hap;

  let svc = accessory.getService(Service.Outlet);
  if (!svc) {
    svc = accessory.addService(Service.Outlet, `${upsName} Output`);
  }

  return {
    update(data, flags) {
      svc.updateCharacteristic(Characteristic.On, flags.onLine || flags.onBattery);
      svc.updateCharacteristic(Characteristic.OutletInUse, (data['ups.load'] || 0) > 0);
    },
  };
};
