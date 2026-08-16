# ADR-0003: HomeKit Service Type Mappings for UPS Metrics

Date: 2026-06-28
Status: Accepted
Deciders: Ben Whiting (Plimmerton Labs)

---

## Context

HomeKit exposes a fixed set of service types, each with characteristic value ranges and semantics defined by Apple's HAP specification. UPS metrics — voltage, load percentage, runtime, battery state, and power status — do not map cleanly onto intuitive service types. The wrong mapping clips values, produces misleading labels in Apple Home, or makes the metric invisible to automations.

The plugin exposes seven UPS metrics as HomeKit tiles. Each required a deliberate choice of service type given HAP constraints.

## Decision

### Battery level and low battery alert → `BatteryService`

The only natural mapping. `BatteryLevel` characteristic accepts 0–100 %, `StatusLowBattery` fires a native alert, and `ChargingState` reflects whether the UPS is on mains power. No alternative considered.

### On-battery status → `OccupancySensor`

`OccupancyDetected = 1` when `ups.status` contains the `OB` (on-battery) flag.

This makes the tile automatable in Apple Home natively — users can trigger "if on battery → send notification / run shutdown script" without third-party apps.

Alternatives considered:

| Option | Reason not chosen |
|--------|-------------------|
| `ContactSensor` | ContactSensorState is binary (open/closed) but semantics imply a physical contact — confusing in Home UI |
| `MotionSensor` | MotionDetected is binary and suitable, but "motion" is misleading for a power-status event |
| `StatefulProgrammableSwitch` | Not automatable in Apple Home |
| `OccupancySensor` | Binary, automatable, and "occupancy detected = something is happening" maps acceptably to "on battery" |

### Load percentage → `Lightbulb` (Brightness characteristic)

`Brightness` is a 0–100 % integer — an exact fit for `ups.load`. The bulb shows as On when load > 0, and the brightness value is displayed in Home.

Alternatives considered:

| Option | Reason not chosen |
|--------|-------------------|
| `Fan` (RotationSpeed) | 0–100 %, but fan semantics confuse users |
| `HumiditySensor` | `CurrentRelativeHumidity` is 0–100 % integer, but humidity semantics are misleading and humidity sensors are not automatable by value in Apple Home |
| `Lightbulb` | Brightness 0–100 % maps naturally; bulb is familiar and automatable |

### Input and output voltage → `LightSensor` (CurrentAmbientLightLevel)

`CurrentAmbientLightLevel` spans 0.0001 to 100,000 lux — wide enough to represent any AC mains voltage (120 V or 230 V) without clipping, and supports float values.

Alternatives considered:

| Option | Reason not chosen |
|--------|-------------------|
| `TemperatureSensor` | `CurrentTemperature` caps at 100 °C — clips standard mains voltages (120 V, 230 V) |
| `HumiditySensor` | Integer-only, max 100 — clips all mains voltages |
| `LightSensor` | Float, range 0.0001–100,000 — fits any realistic AC voltage without clipping |

Two separate `LightSensor` services are registered with distinct subtypes (`input-voltage` and `output-voltage`) so HAP does not deduplicate them.

### Runtime remaining → `TemperatureSensor` (CurrentTemperature)

`CurrentTemperature` accepts float values in the range 0–100 °C. UPS runtime reported by NUT is in seconds; dividing by 60 converts to minutes. Typical UPS runtimes fall in the 0–100 minute range, mapping well to the temperature range.

Alternatives considered:

| Option | Reason not chosen |
|--------|-------------------|
| `HumiditySensor` | Integer-only — loses sub-minute precision |
| `LightSensor` | Would work numerically, but two voltage tiles already use LightSensor; a third would require a third subtype and risks confusion |
| `TemperatureSensor` | Float, 0–100 range matches typical runtime in minutes, distinct from voltage tiles |

### Why not custom characteristics

Custom characteristics appear in third-party apps (Eve, Controller for HomeKit) but are invisible in Apple's own Home app. Because the primary target is Apple Home automations, all metrics must use standard HAP service types and characteristics. This constraint drives all the above choices.

## Consequences

### Positive

- All metrics are visible and automatable in Apple Home without third-party apps
- Value ranges fit UPS data without clipping
- The HomeKit tile table in README and the `lib/tiles/` module structure document the rationale at the point of implementation

### Negative / Trade-offs

- Service types are semantically odd (a "lightbulb" for load, a "light sensor" for voltage) — users may find the Home app labels confusing without the README explanation
- Runtime displays as a temperature value in Home, which can surprise users who inspect the raw tile

### Risks and mitigations

The main risk is future HAP spec changes that alter value ranges for these characteristics. Mitigated by: the README explains the reasoning, this ADR records the constraints, and the mapping is isolated to individual tile modules that can be changed independently.

## Follow-up

- Consider adding in-app UI labels in the standalone dashboard to clarify units wherever HomeKit service semantics are misleading.

