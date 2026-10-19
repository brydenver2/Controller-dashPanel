/**
 * AquaButler canonical MQTT topic constants.
 *
 * Source of truth: ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md v1.0
 * (authored by Shuri, 2026-10-18; reviewed by Friday as both firmware and
 * dashPanel consumer). Do NOT mutate these literals without bumping the
 * schema version below and updating both consumers.
 *
 * Cross-references:
 *   - Pin: ~/AquaButler-Server/src/rotary_display/rotary_display/mqtt/topics.py
 *     (the firmware side of the same schema; this side mirrors the same
 *     topic-string constants on the JS/TS side).
 *   - Follow-up card t_17b00b59: extract these into a shared constants
 *     module so neither side has its own copy.
 */
export const AQUABUTLER_MQTT_SCHEMA_VERSION = "1.0";

/**
 * Namespace constant: `pool/<customer_id>/...`
 * Single-level wildcard (+) is used at the subscription layer to fan in
 * from "any customer", but every publish must carry the literal
 * <customer_id> — never a wildcard.
 */
export const poolPrefix = (customerId: string): string =>
  `pool/${encodeURIComponent(customerId)}`;

/** Read-side leaves per schema §Read. */
export const TELEMETRY_LEAF = {
  ph: "ph",
  orpMv: "orp_mV",
  pumpState: "pump_state",
  pumpRpm: "pump_rpm",
  tempPool: "temp_pool",
  tempAir: "temp_air",
  heaterSetpointF: "heater_setpoint_f",
  lastHeard: "_last_heard",
} as const;

export const STATUS_LEAF = {
  mode: "mode",
  lastError: "last_error",
  errors24h: "errors_24h",
  runHours: "run_hours",
  wifiRssiDbm: "wifi_rssi_dbm",
} as const;

export const HEALTH_LEAF = {
  system: "system",
  comm: "comm",
  thermal: "thermal",
} as const;

/** Write-side action families per schema §Write. */
export const MANUAL_ACTION = {
  pump: "pump",
  filter: "filter",
  chlorination: "chlorination",
  heater: "heater",
} as const;

export type ManualAction = typeof MANUAL_ACTION[keyof typeof MANUAL_ACTION];

export const SERVICE_ACTION = {
  enter: "enter",
  exit: "exit",
  forceExit: "force_exit",
} as const;

export type ServiceAction = typeof SERVICE_ACTION[keyof typeof SERVICE_ACTION];

/** Source-of-action labels per schema §Write (auth.source). */
export const AUTH_SOURCE = {
  rotaryDisplay: "rotary_display",
  dashpanel: "dashpanel",
  portal: "portal",
  cloud: "cloud",
} as const;

export type AuthSource = typeof AUTH_SOURCE[keyof typeof AUTH_SOURCE];

/* -----------------------------------------------------------------------
 * Topic builders — use these everywhere; never hand-construct a topic
 * string with concatenation (drift is one missed slash away).
 * --------------------------------------------------------------------- */

export const telemetryTopic = (customerId: string, leaf: string): string =>
  `${poolPrefix(customerId)}/telemetry/${leaf}`;

export const statusTopic = (customerId: string, leaf: string): string =>
  `${poolPrefix(customerId)}/status/${leaf}`;

export const healthTopic = (customerId: string, leaf: string): string =>
  `${poolPrefix(customerId)}/health/${leaf}`;

export const displayStateTopic = (customerId: string): string =>
  `${poolPrefix(customerId)}/display/state`;

export const serviceStateTopic = (customerId: string): string =>
  `${poolPrefix(customerId)}/service/state`;

export const auditManualTopic = (customerId: string): string =>
  `${poolPrefix(customerId)}/audit/manual`;

export const auditServiceTopic = (customerId: string): string =>
  `${poolPrefix(customerId)}/audit/service`;

export const manualCommandTopic = (
  customerId: string,
  action: ManualAction,
): string => `${poolPrefix(customerId)}/command/manual/${action}/set`;

export const serviceCommandTopic = (customerId: string): string =>
  `${poolPrefix(customerId)}/command/service/set`;

/** Subscribe filter — used at boot to fan in from the active customer. */
export const activeCustomerFilter = (customerId: string): string =>
  `${poolPrefix(customerId)}/#`;

/**
 * Wildcard subscribers — used by cross-customer consumers (bridge,
 * alerts, fleet-alerts, future HA admin tooling). The dashPanel Layer 1
 * code path uses `activeCustomerFilter(id)` for the single-customer
 * subscription; these wildcards are reserved for a future Layer 2+
 * "fleet view" once @ultron_wallace_bot signs off on cross-customer
 * ACLs (not in scope for this commit).
 */
export const SUBSCRIBE_ALL_READ = "pool/+/telemetry/#";
export const SUBSCRIBE_ALL_STATUS = "pool/+/status/#";
export const SUBSCRIBE_ALL_HEALTH = "pool/+/health/#";
export const SUBSCRIBE_ALL_DISPLAY = "pool/+/display/state";
export const SUBSCRIBE_ALL_SERVICE = "pool/+/service/state";
export const SUBSCRIBE_ALL_AUDIT_MANUAL = "pool/+/audit/manual";
export const SUBSCRIBE_ALL_AUDIT_SERVICE = "pool/+/audit/service";
