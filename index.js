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

const { queryNUT, listInstCmds, listRWVars, sendInstCmd, setVar } = require('./lib/nutClient');
const { parseStatusFlags } = require('./lib/nutParser');
const RingBuffer           = require('./lib/ringBuffer');
const DailyLog             = require('./lib/dailyLog');
const OutageLog            = require('./lib/outageLog');
const DashboardServer      = require('./lib/dashboardServer');
const { resolveDataDir, migrateLegacyFiles, migrateLegacyLocations } = require('./lib/storagePaths');

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
const setupAlarmTile        = require('./lib/tiles/alarmTile');

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

    // Parse config into connection/polling/feature settings, then resolve the
    // data directory (running any one-time history migrations).
    this._applyConfig(config);
    this._initStorage();

    // Per-UPS state, keyed by UPS name (one entry each, created in setupPolling):
    this.ringBuffers = new Map();   // → RingBuffer  (history file)
    this.dailyLogs   = new Map();   // → DailyLog    (30-day CSV log)
    this.outageLogs  = new Map();   // → OutageLog   (outage timeline)
    this._pollTimers = new Map();   // → pending poll timer (stable handle)

    this.log.info(
      `NUT UPS Monitor starting — server: ${this.host}:${this.port}, ` +
      `UPS: [${this.upsList.join(', ')}]`
    );

    // Standalone dashboard server — optional, configured by standalonePort.
    this._dashboardServer = null;
    this._maybeStartStandaloneServer(config.standalonePort);

    this.api.on('didFinishLaunching', () => this.initAccessories());
    this.api.on('shutdown', () => this._shutdown());
  }

  // ─── Construction helpers ──────────────────────────────────────────────────

  // Parse and validate the platform config into connection, polling, and
  // feature settings. Both control features write to the UPS, so they default
  // off; pollInterval is validated up front so a bad value can never produce a
  // tight poll loop (see _resolvePollSec).
  _applyConfig(config) {
    // Connection settings
    this.host     = config.host     || '127.0.0.1';
    this.port     = config.port     || 3493;
    this.username = config.username || null;
    this.password = config.password || null;

    // UPS name(s) — typically just ['ups']
    this.upsList  = Array.isArray(config.ups) ? config.ups : [config.ups || 'ups'];

    // Polling interval (seconds → ms)
    this.pollSec = this._resolvePollSec(config.pollInterval);
    this.pollMs  = this.pollSec * 1000;

    // Low battery threshold
    this.lowBatThreshold = config.lowBatteryThreshold || 20;

    // UPS control features — opt-in (both write to the UPS, so default off)
    this.alarmControl            = config.alarmControl === true;
    this.syncLowBatteryThreshold = config.syncLowBatteryThreshold === true;
  }

  // Resolve the data directory and migrate any history files left behind by an
  // older version or a previous storage location, so history survives upgrades.
  _initStorage() {
    // Prefer the path Homebridge gives us via the API (honours custom -U dirs);
    // fall back to UIX_STORAGE_PATH / ~/.homebridge for older cores or tests.
    this.storagePath = (this.api && this.api.user && typeof this.api.user.storagePath === 'function'
      ? this.api.user.storagePath()
      : null)
      || process.env.UIX_STORAGE_PATH
      || path.join(os.homedir(), '.homebridge');

    // Keep data files in a dedicated subdirectory of the storage path (tidier
    // than the storage root). Migrate any legacy files into it once.
    this.dataDir = resolveDataDir(this.storagePath);
    // Files left in the storage root by older versions...
    migrateLegacyFiles(this.storagePath, this.dataDir, this.log);
    // ...and any left behind in a previous storage location (e.g. the old
    // ~/.homebridge / UIX_STORAGE_PATH fallback).
    migrateLegacyLocations(this.dataDir, this.storagePath, this.log);
  }

  // Start the optional standalone dashboard server when standalonePort is set
  // and valid. Logs and skips on an invalid port rather than throwing.
  _maybeStartStandaloneServer(standalonePort) {
    if (standalonePort == null || standalonePort === '') return;

    const portNum = Number(standalonePort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      this.log.error(
        `[UPS Dashboard] Invalid standalonePort "${standalonePort}" — must be an integer 1–65535. ` +
        'Standalone dashboard not started.'
      );
      return;
    }
    this._startDashboardServer(portNum);
  }

  // Start the optional standalone dashboard web server on the given (validated) port.
  _startDashboardServer(port) {
    this._dashboardServer = new DashboardServer({
      storagePath: this.dataDir,
      upsNames:    this.upsList,
      host:        this.host,
      nutPort:     this.port,
      username:    this.username,
      password:    this.password,
      log:         this.log,
    });
    this._dashboardServer.start(port).catch(err => {
      this.log.error(`[UPS Dashboard] Failed to start standalone server: ${err.message}`);
    });
  }

  // Opt-in UPS control features. Probes the device for support and degrades
  // gracefully (logs, never throws) when commands/vars aren't available or the
  // credentials don't permit control. Many UPSes are monitor-only.
  async _setupControls(accessory, upsName, tiles) {
    if (this.alarmControl) {
      try {
        const cmds = await listInstCmds(this.host, this.port, upsName, this.username, this.password);
        if (cmds.includes('beeper.disable') || cmds.includes('beeper.enable')) {
          const alarmTile = setupAlarmTile(accessory, this.api, upsName, {
            log: this.log,
            sendCommand: (enable) => sendInstCmd(
              this.host, this.port, upsName, this.username, this.password,
              enable ? 'beeper.enable' : 'beeper.disable',
            ),
          });
          tiles.push(alarmTile);
          this.log.info(`[${upsName}] Alarm control enabled (beeper INSTCMD supported).`);
        } else {
          this.log.warn(`[${upsName}] alarmControl is on but the UPS does not advertise beeper commands — skipping alarm switch.`);
        }
      } catch (err) {
        this.log.warn(`[${upsName}] Could not probe alarm support: ${err.message} — skipping alarm switch.`);
      }
    }

    if (this.syncLowBatteryThreshold) {
      try {
        const rw = await listRWVars(this.host, this.port, upsName, this.username, this.password);
        if (rw.includes('battery.charge.low')) {
          const res = await setVar(
            this.host, this.port, upsName, this.username, this.password,
            'battery.charge.low', this.lowBatThreshold,
          );
          if (res.ok) {
            this.log.info(`[${upsName}] Synced low-battery threshold to UPS: battery.charge.low=${this.lowBatThreshold}.`);
          } else {
            this.log.warn(`[${upsName}] Failed to set battery.charge.low: ${res.message}.`);
          }
        } else {
          this.log.warn(`[${upsName}] syncLowBatteryThreshold is on but battery.charge.low is not writable on this UPS — skipping.`);
        }
      } catch (err) {
        this.log.warn(`[${upsName}] Could not sync low-battery threshold: ${err.message}.`);
      }
    }
  }

  // Validate the configured poll interval (seconds). Returns a safe integer:
  // a finite value >= 1 is floored and used; anything else falls back to 30 and
  // logs a warning when a value was actually provided.
  _resolvePollSec(raw) {
    if (raw == null || raw === '') return 30;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    this.log.warn(
      `Invalid pollInterval "${raw}" — must be a number >= 1 (seconds). Falling back to 30s.`
    );
    return 30;
  }

  // Clean up on Homebridge shutdown: cancel pending poll timers and stop the
  // standalone dashboard server, so a dynamic-platform reload does not leak
  // timers or a listening socket.
  _shutdown() {
    for (const timer of this._pollTimers.values()) {
      clearTimeout(timer);
    }
    this._pollTimers.clear();

    if (this._dashboardServer) {
      Promise.resolve(this._dashboardServer.stop()).catch(() => { /* best-effort */ });
      this._dashboardServer = null;
    }
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

  // Wire up one UPS accessory: accessory info, persistence stores, tiles, the
  // opt-in control features, and the self-scheduling poll loop.
  setupPolling(accessory, upsName) {
    this._setAccessoryInfo(accessory, upsName);

    const stores = this._createStores(upsName);
    const tiles  = this._createTiles(accessory, upsName);

    // Opt-in control features (alarm switch, threshold sync) — set up
    // asynchronously after a capability probe; never blocks polling.
    this._setupControls(accessory, upsName, tiles);

    this._startPollLoop(upsName, tiles, stores);
  }

  // Populate the HomeKit Accessory Information service.
  _setAccessoryInfo(accessory, upsName) {
    const { Characteristic, Service } = this.api.hap;
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'NUT / Network UPS Tools')
      .setCharacteristic(Characteristic.Model,         'UPS Monitor')
      .setCharacteristic(Characteristic.SerialNumber,  upsName);
  }

  // Create and register the three persistence stores for a UPS.
  // @returns {{ ringBuf: RingBuffer, dailyLog: DailyLog, outageLog: OutageLog }}
  _createStores(upsName) {
    // Ring buffer sized to retain ~24 h of history at the configured poll
    // interval (e.g. 2880 points at 30 s). Bounded so very fast poll intervals
    // don't produce an oversized backing file.
    const capacity = Math.min(8640, Math.max(1440, Math.ceil(86400 / this.pollSec)));
    const histFile = path.join(this.dataDir, `ups-history-${upsName}.json`);
    const ringBuf  = new RingBuffer(histFile, capacity);
    this.ringBuffers.set(upsName, ringBuf);

    // Daily CSV log for this UPS (30 days of per-minute voltage + load data)
    const dailyLog = new DailyLog(this.dataDir, upsName, 30);
    this.dailyLogs.set(upsName, dailyLog);

    // Outage timeline for this UPS
    const outageLog = new OutageLog(this.dataDir, upsName, { log: this.log });
    this.outageLogs.set(upsName, outageLog);

    return { ringBuf, dailyLog, outageLog };
  }

  // Initialise the seven always-on tiles; each returns an update() function.
  _createTiles(accessory, upsName) {
    return [
      setupBatteryTile(accessory, this.api, upsName, { lowBatThreshold: this.lowBatThreshold }),
      setupOutletTile(accessory, this.api, upsName),
      setupOnBatteryTile(accessory, this.api, upsName),
      setupLoadTile(accessory, this.api, upsName),
      setupInputVoltageTile(accessory, this.api, upsName),
      setupOutputVoltageTile(accessory, this.api, upsName),
      setupRuntimeTile(accessory, this.api, upsName),
    ];
  }

  // Map a raw NUT data object to a compact telemetry point (null for missing).
  _buildPoint(data) {
    return {
      t:       new Date().toISOString(),
      inV:     data['input.voltage']   ?? null,
      outV:    data['output.voltage']  ?? null,
      bat:     data['battery.charge']  ?? null,
      load:    data['ups.load']        ?? null,
      runtime: data['battery.runtime'] ?? null,
    };
  }

  // Self-scheduling poll loop for one UPS. Each poll catches its own errors and
  // re-arms the next only after it settles, so a slow NUT query can never
  // overlap the next poll. The timer is unref'd so it does not hold the process
  // open, and is tracked per-UPS for a clean shutdown.
  _startPollLoop(upsName, tiles, stores) {
    const poll = async () => {
      try {
        const data  = await queryNUT(this.host, this.port, upsName, this.username, this.password);
        const flags = parseStatusFlags(data['ups.status']);

        // Push fresh data into every tile
        tiles.forEach(tile => tile.update(data, flags));

        // Persist one telemetry point to all three stores
        const point = this._buildPoint(data);
        stores.ringBuf.push(point);
        stores.outageLog.record({ t: point.t, flags, batteryCharge: point.bat });
        stores.dailyLog.append(point);

        this.log.debug(
          `[${upsName}] ${flags.raw} | ` +
          `in=${data['input.voltage']}V out=${data['output.voltage']}V | ` +
          `bat=${data['battery.charge']}% load=${data['ups.load']}% ` +
          `runtime=${Math.round((data['battery.runtime'] || 0) / 60)}min`
        );
      } catch (err) {
        // NUTQueryError (see lib/nutClient.js) already folds its NUT protocol
        // error code into err.message; when it also has actionable guidance,
        // append it so the log line is useful on its own, without requiring a
        // trip to the dashboard. A plain Error (network failure, timeout) just
        // logs its message as before.
        const guidance = err.guidance ? ` — ${err.guidance}` : '';
        this.log.error(`[${upsName}] NUT query failed: ${err.message}${guidance}`);
      }
    };

    const scheduleNext = () => {
      const timer = setTimeout(tick, this.pollMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      this._pollTimers.set(upsName, timer);
    };
    const tick = async () => {
      await poll();
      scheduleNext();
    };

    // First poll immediately, then re-arm after each completes.
    tick();
  }
}
