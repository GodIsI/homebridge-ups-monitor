'use strict';

/**
 * homebridge-ups-monitor
 *
 * Homebridge platform plugin that reads UPS data from a NUT server (upsd)
 * over the native NUT TCP protocol (port 3493) and exposes each UPS as a
 * HomeKit accessory with seven services/tiles:
 *
 *   Battery         — charge %, charging state, low-battery alert
 *   Outlet          — on/in-use indicator
 *   OccupancySensor — fires when UPS switches to battery
 *   Lightbulb       — load % as brightness
 *   LightSensor ×2  — input and output voltage
 *   TemperatureSensor — runtime remaining in minutes
 *
 * A custom Homebridge UI panel (homebridge-ui/) shows a live dashboard with
 * voltage, battery %, load %, and runtime — see homebridge-ui/public/index.html.
 */

const { queryNUT }        = require('./lib/nutClient');
const { parseStatusFlags } = require('./lib/nutParser');
const RingBuffer           = require('./lib/ringBuffer');
const DailyLog             = require('./lib/dailyLog');

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Tile modules — one service per file ──────────────────────────────────────
const setupBatteryTile      = require('./lib/tiles/batteryTile');
const setupOutletTile       = require('./lib/tiles/outletTile');
const setupOnBatteryTile    = require('./lib/tiles/onBatteryTile');
const setupLoadTile         = require('./lib/tiles/loadTile');
const setupInputVoltageTile = require('./lib/tiles/inputVoltageTile');
const setupOutputVoltageTile= require('./lib/tiles/outputVoltageTile');
const setupRuntimeTile      = require('./lib/tiles/runtimeTile');

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
    this.pollMs   = (config.pollInterval || 30) * 1000;

    // Low battery threshold
    this.lowBatThreshold = config.lowBatteryThreshold || 20;

    // Storage path for ring-buffer history files
    // Resolved the same way as server.js so both processes share the same files
    this.storagePath = process.env.UIX_STORAGE_PATH
      || path.join(os.homedir(), '.homebridge');

    // Map of upsName → RingBuffer instance (one file per UPS)
    this.ringBuffers = new Map();

    // Map of upsName → DailyLog instance (30-day CSV log per UPS)
    this.dailyLogs = new Map();

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

  // ─── Accessory setup & poll loop ──────────────────────────────────────────
  setupPolling(accessory, upsName) {
    // Accessory Information
    const { Characteristic, Service } = this.api.hap;
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'NUT / Network UPS Tools')
      .setCharacteristic(Characteristic.Model,         'UPS Monitor')
      .setCharacteristic(Characteristic.SerialNumber,  upsName);

    // Ring buffer for this UPS (1440 points = 1 per minute for 24 h)
    const histFile = path.join(this.storagePath, `ups-history-${upsName}.json`);
    const ringBuf  = new RingBuffer(histFile, 1440);
    this.ringBuffers.set(upsName, ringBuf);

    // Daily CSV log for this UPS (30 days of per-minute voltage + load data)
    const dailyLog = new DailyLog(this.storagePath, upsName, 30);
    this.dailyLogs.set(upsName, dailyLog);

    // Initialise all tiles — each returns an update() function
    const tiles = [
      setupBatteryTile(accessory, this.api, upsName, { lowBatThreshold: this.lowBatThreshold }),
      setupOutletTile(accessory, this.api, upsName),
      setupOnBatteryTile(accessory, this.api, upsName),
      setupLoadTile(accessory, this.api, upsName),
      setupInputVoltageTile(accessory, this.api, upsName),
      setupOutputVoltageTile(accessory, this.api, upsName),
      setupRuntimeTile(accessory, this.api, upsName),
    ];

    const poll = async () => {
      try {
        const data  = await queryNUT(this.host, this.port, upsName, this.username, this.password);
        const flags = parseStatusFlags(data['ups.status']);

        // Push fresh data into every tile
        tiles.forEach(tile => tile.update(data, flags));

        // Append telemetry point to the persistent ring buffer
        const point = {
          t:       new Date().toISOString(),
          inV:     data['input.voltage']   ?? null,
          outV:    data['output.voltage']  ?? null,
          bat:     data['battery.charge']  ?? null,
          load:    data['ups.load']        ?? null,
          runtime: data['battery.runtime'] ?? null,
        };
        ringBuf.push(point);

        // Append voltage + load to the 30-day daily CSV log
        dailyLog.append({ t: point.t, inV: point.inV, outV: point.outV, load: point.load });

        this.log.debug(
          `[${upsName}] ${flags.raw} | ` +
          `in=${data['input.voltage']}V out=${data['output.voltage']}V | ` +
          `bat=${data['battery.charge']}% load=${data['ups.load']}% ` +
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
