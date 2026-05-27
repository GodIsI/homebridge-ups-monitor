'use strict';

/**
 * homebridge-ups-monitor
 *
 * Homebridge platform plugin that reads UPS data from a NUT server (upsd)
 * over the native NUT TCP protocol (port 3493) and exposes each UPS as a
 * HomeKit accessory with a Battery service and an Outlet service.
 *
 * A custom Homebridge UI panel (homebridge-ui/) shows a live dashboard with
 * voltage, battery %, load %, and runtime — see homebridge-ui/public/index.html.
 *
 * Installation:
 *   npm install -g homebridge-ups-monitor    (from npm once published)
 *   sudo npm install -g .                    (from this directory for local dev)
 * Then add to Homebridge config.json:
 *   { "platform": "NUTDashboard", "name": "UPS Monitor" }
 * Or search "UPS Monitor" in the Homebridge UI plugin store.
 */

const { queryNUT }        = require('./lib/nutClient');
const { parseStatusFlags } = require('./lib/nutParser');

const PLUGIN_NAME   = 'homebridge-ups-monitor';
const PLATFORM_NAME = 'NUTDashboard';

// ─── Homebridge entry point ───────────────────────────────────────────────────
module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NUTDashboardPlatform);
};

// ─── Platform ─────────────────────────────────────────────────────────────────
class NUTDashboardPlatform {
  constructor(log, config, api) {
    this.log    = log;
    this.config = config;
    this.api    = api;

    // Map of UUID → cached platformAccessory (restored by Homebridge on restart)
    this.cachedAccessories = new Map();

    // Connection settings
    this.host     = config.host     || '127.0.0.1';
    this.port     = config.port     || 3493;
    this.username = config.username || null;
    this.password = config.password || null;

    // UPS name(s) — typically just ['ups']
    this.upsList  = Array.isArray(config.ups) ? config.ups : [config.ups || 'ups'];

    // Polling interval in ms
    this.pollMs   = ((config.pollInterval || 30) * 1000);

    // Low battery threshold
    this.lowBatThreshold = config.lowBatteryThreshold || 20;

    this.log.info(
      `NUT UPS Monitor starting — server: ${this.host}:${this.port}, ` +
      `UPS: [${this.upsList.join(', ')}]`
    );

    this.api.on('didFinishLaunching', () => this.initAccessories());
  }

  // Called by Homebridge for every accessory it already knows about
  configureAccessory(accessory) {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  initAccessories() {
    for (const upsName of this.upsList) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${upsName}`);
      let accessory = this.cachedAccessories.get(uuid);

      if (!accessory) {
        this.log.info(`Registering new accessory for UPS: ${upsName}`);
        accessory = new this.api.platformAccessory(`${upsName.toUpperCase()} UPS`, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.set(uuid, accessory);
      }

      this.setupPolling(accessory, upsName);
    }
  }

  // ─── Accessory setup & polling ─────────────────────────────────────────────
  setupPolling(accessory, upsName) {
    const { Characteristic, Service } = this.api.hap;

    // Accessory Information
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'NUT / Network UPS Tools')
      .setCharacteristic(Characteristic.Model,         'UPS Monitor')
      .setCharacteristic(Characteristic.SerialNumber,  upsName);

    // Battery Service — shows battery %, charging state, low battery alert
    let batterySvc = accessory.getService(Service.Battery);
    if (!batterySvc) {
      batterySvc = accessory.addService(Service.Battery, `${upsName} Battery`);
    }

    // Outlet Service — On = UPS is providing power; OutletInUse = load > 0
    let outletSvc = accessory.getService(Service.Outlet);
    if (!outletSvc) {
      outletSvc = accessory.addService(Service.Outlet, `${upsName} Output`);
    }

    const poll = async () => {
      try {
        const data  = await queryNUT(this.host, this.port, upsName, this.username, this.password);
        const flags = parseStatusFlags(data['ups.status']);

        // ── Battery Level ────────────────────────────────────────────────────
        const charge = data['battery.charge'];
        if (charge !== undefined) {
          batterySvc.updateCharacteristic(
            Characteristic.BatteryLevel,
            Math.min(100, Math.max(0, Math.round(charge)))
          );
          batterySvc.updateCharacteristic(
            Characteristic.StatusLowBattery,
            charge < this.lowBatThreshold
              ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
              : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
          );
        }

        // ── Charging state ───────────────────────────────────────────────────
        batterySvc.updateCharacteristic(
          Characteristic.ChargingState,
          flags.charging
            ? Characteristic.ChargingState.CHARGING
            : Characteristic.ChargingState.NOT_CHARGING
        );

        // ── Outlet ───────────────────────────────────────────────────────────
        outletSvc.updateCharacteristic(Characteristic.On, flags.onLine || flags.onBattery);
        const load = data['ups.load'];
        outletSvc.updateCharacteristic(Characteristic.OutletInUse, (load || 0) > 0);

        this.log.debug(
          `[${upsName}] ${flags.raw} | ` +
          `in=${data['input.voltage']}V out=${data['output.voltage']}V | ` +
          `bat=${charge}% load=${load}% ` +
          `runtime=${Math.round((data['battery.runtime'] || 0) / 60)}min`
        );
      } catch (err) {
        this.log.error(`[${upsName}] NUT query failed: ${err.message}`);
      }
    };

    // First poll immediately, then on interval
    poll();
    setInterval(poll, this.pollMs);
  }
}
