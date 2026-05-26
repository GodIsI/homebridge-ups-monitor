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

const net = require('net');

const PLUGIN_NAME  = 'homebridge-ups-monitor';
const PLATFORM_NAME = 'NUTDashboard';

// NUT variables we request on every poll
const NUT_VARS = [
  'ups.status',
  'input.voltage',
  'output.voltage',
  'battery.charge',
  'ups.load',
  'battery.runtime',   // seconds
  'battery.voltage',
  'ups.model',
  'ups.mfr',
];

// ─── NUT TCP client ───────────────────────────────────────────────────────────
/**
 * Open a single TCP connection to upsd, send all GET VAR commands followed by
 * LOGOUT, collect the responses, then return a plain object keyed by variable
 * name.  Numeric values are coerced to numbers; string values stay as strings.
 *
 * @param {string}      host
 * @param {number}      port
 * @param {string}      upsName   e.g. 'ups'
 * @param {string|null} username
 * @param {string|null} password
 * @returns {Promise<Object>}
 */
function queryNUT(host, port, upsName, username, password) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: port || 3493, host: host || '127.0.0.1' });
    socket.setTimeout(8000);

    let buffer = '';

    // Build the command list; auth lines only if credentials are provided
    const cmds = [];
    if (username) cmds.push(`USERNAME ${username}`);
    if (password) cmds.push(`PASSWORD ${password}`);
    NUT_VARS.forEach(v => cmds.push(`GET VAR ${upsName} ${v}`));
    cmds.push('LOGOUT');

    socket.on('connect', () => {
      socket.write(cmds.join('\n') + '\n');
    });

    socket.on('data', chunk => {
      buffer += chunk.toString();
    });

    // Parse VAR lines out of the accumulated buffer
    const parse = () => {
      const result = {};
      for (const line of buffer.split('\n')) {
        // NUT response format:  VAR <ups> <variable> "<value>"
        const m = line.match(/^VAR \S+ (\S+) "(.*)"/);
        if (m) {
          const raw = m[2];
          result[m[1]] = (raw !== '' && !isNaN(raw)) ? parseFloat(raw) : raw;
        }
      }
      resolve(result);
    };

    socket.on('end',   parse);
    socket.on('close', parse);
    socket.on('error', err => reject(err));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('NUT connection timed out'));
    });
  });
}

// ─── Homebridge entry point ───────────────────────────────────────────────────
module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NUTDashboardPlatform);
};

// ─── Platform ─────────────────────────────────────────────────────────────────
class NUTDashboardPlatform {
  constructor(log, config, api) {
    this.log  = log;
    this.config = config;
    this.api  = api;

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

    this.log.info(`NUT UPS Dashboard starting — server: ${this.host}:${this.port}, UPS: [${this.upsList.join(', ')}]`);

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
        const data = await queryNUT(this.host, this.port, upsName, this.username, this.password);

        // ── Battery Level ──────────────────────────────────────────────────────
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

        // ── UPS Status string (e.g. "OL", "OB DISCHRG", "LB") ─────────────────
        const status   = String(data['ups.status'] || '');
        const onLine   = status.includes('OL');   // connected to mains
        const onBatt   = status.includes('OB');   // running on battery
        const charging = onLine && !status.includes('DISCHRG');

        batterySvc.updateCharacteristic(
          Characteristic.ChargingState,
          charging
            ? Characteristic.ChargingState.CHARGING
            : Characteristic.ChargingState.NOT_CHARGING
        );

        // ── Outlet ─────────────────────────────────────────────────────────────
        // "On" means the UPS is actively supplying power (either from mains or battery)
        outletSvc.updateCharacteristic(Characteristic.On, onLine || onBatt);
        const load = data['ups.load'];
        outletSvc.updateCharacteristic(Characteristic.OutletInUse, (load || 0) > 0);

        this.log.debug(
          `[${upsName}] status=${status} | ` +
          `input=${data['input.voltage']}V | output=${data['output.voltage']}V | ` +
          `battery=${charge}% | load=${load}% | runtime=${Math.round((data['battery.runtime'] || 0) / 60)}min`
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
