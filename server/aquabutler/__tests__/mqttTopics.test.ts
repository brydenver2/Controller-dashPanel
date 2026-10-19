/**
 * Tests for the AquaButler MQTT topic-name constants.
 *
 * These are critical: per the schema v1.0 doc, every consumer (firmware
 * on the CM4, dashPanel, customer portal) must agree on these strings.
 * A typo or rename here breaks every consumer silently.
 *
 * The companion test (in the firmware repo) does the same thing from
 * the Python side; this is the JS/TS side of the same assertion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AQUABUTLER_MQTT_SCHEMA_VERSION,
  poolPrefix,
  telemetryTopic,
  statusTopic,
  healthTopic,
  displayStateTopic,
  serviceStateTopic,
  auditManualTopic,
  auditServiceTopic,
  manualCommandTopic,
  serviceCommandTopic,
  activeCustomerFilter,
  TELEMETRY_LEAF,
  STATUS_LEAF,
  HEALTH_LEAF,
  MANUAL_ACTION,
  SERVICE_ACTION,
  AUTH_SOURCE,
  SUBSCRIBE_ALL_READ,
  SUBSCRIBE_ALL_STATUS,
  SUBSCRIBE_ALL_HEALTH,
  SUBSCRIBE_ALL_DISPLAY,
  SUBSCRIBE_ALL_SERVICE,
  SUBSCRIBE_ALL_AUDIT_MANUAL,
  SUBSCRIBE_ALL_AUDIT_SERVICE,
} from "../mqttTopics";

const SAMPLE_CUSTOMER = "abc-12345";

test("schema version pinned at v1.0", () => {
  assert.equal(AQUABUTLER_MQTT_SCHEMA_VERSION, "1.0");
});

test("poolPrefix encodes the customer_id", () => {
  assert.equal(poolPrefix(SAMPLE_CUSTOMER), "pool/abc-12345");
});

test("topic builders match schema v1.0 leaf set", () => {
  assert.equal(telemetryTopic(SAMPLE_CUSTOMER, "ph"), "pool/abc-12345/telemetry/ph");
  assert.equal(telemetryTopic(SAMPLE_CUSTOMER, "orp_mV"), "pool/abc-12345/telemetry/orp_mV");
  assert.equal(statusTopic(SAMPLE_CUSTOMER, "mode"), "pool/abc-12345/status/mode");
  assert.equal(healthTopic(SAMPLE_CUSTOMER, "system"), "pool/abc-12345/health/system");
  assert.equal(displayStateTopic(SAMPLE_CUSTOMER), "pool/abc-12345/display/state");
  assert.equal(serviceStateTopic(SAMPLE_CUSTOMER), "pool/abc-12345/service/state");
  assert.equal(auditManualTopic(SAMPLE_CUSTOMER), "pool/abc-12345/audit/manual");
  assert.equal(auditServiceTopic(SAMPLE_CUSTOMER), "pool/abc-12345/audit/service");
  assert.equal(manualCommandTopic(SAMPLE_CUSTOMER, MANUAL_ACTION.pump), "pool/abc-12345/command/manual/pump/set");
  assert.equal(manualCommandTopic(SAMPLE_CUSTOMER, MANUAL_ACTION.filter), "pool/abc-12345/command/manual/filter/set");
  assert.equal(manualCommandTopic(SAMPLE_CUSTOMER, MANUAL_ACTION.chlorination), "pool/abc-12345/command/manual/chlorination/set");
  assert.equal(manualCommandTopic(SAMPLE_CUSTOMER, MANUAL_ACTION.heater), "pool/abc-12345/command/manual/heater/set");
  assert.equal(serviceCommandTopic(SAMPLE_CUSTOMER), "pool/abc-12345/command/service/set");
});

test("activeCustomerFilter matches all subtree under the customer", () => {
  assert.equal(activeCustomerFilter(SAMPLE_CUSTOMER), "pool/abc-12345/#");
});

test("telemetry leaf catalog matches the firmware's catalog", () => {
  // If you change this list, change the firmware's MQTT_TOPICS constants
  // and update the schema doc. The list below is the union pinned in
  // ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md v1.0.
  const expectedTelemetryLeaves = [
    "ph", "orp_mV", "pump_state", "pump_rpm",
    "temp_pool", "temp_air", "heater_setpoint_f", "_last_heard",
  ];
  assert.deepEqual(Object.values(TELEMETRY_LEAF).sort(), expectedTelemetryLeaves.sort());
});

test("status leaf catalog matches schema v1.0", () => {
  const expected = ["mode", "last_error", "errors_24h", "run_hours", "wifi_rssi_dbm"];
  assert.deepEqual(Object.values(STATUS_LEAF).sort(), expected.sort());
});

test("health leaf catalog matches schema v1.0 (3 subsystems)", () => {
  const expected = ["system", "comm", "thermal"];
  assert.deepEqual(Object.values(HEALTH_LEAF).sort(), expected.sort());
});

test("manual action catalog matches schema v1.0 (4 actions)", () => {
  const expected = ["pump", "filter", "chlorination", "heater"];
  assert.deepEqual(Object.values(MANUAL_ACTION).sort(), expected.sort());
});

test("service action catalog matches schema v1.0 (3 actions)", () => {
  const expected = ["enter", "exit", "force_exit"];
  assert.deepEqual(Object.values(SERVICE_ACTION).sort(), expected.sort());
});

test("auth source catalog matches schema v1.0 (4 sources)", () => {
  const expected = ["rotary_display", "dashpanel", "portal", "cloud"];
  assert.deepEqual(Object.values(AUTH_SOURCE).sort(), expected.sort());
});

test("subscribe wildcards never include command topics (commands are write-only)", () => {
  // Schema v1.0: dashPanel does NOT subscribe to pool/+/command/#
  // — those are written, not read. Drift here would cause infinite echo.
  for (const wc of [
    SUBSCRIBE_ALL_READ,
    SUBSCRIBE_ALL_STATUS,
    SUBSCRIBE_ALL_HEALTH,
    SUBSCRIBE_ALL_DISPLAY,
    SUBSCRIBE_ALL_SERVICE,
    SUBSCRIBE_ALL_AUDIT_MANUAL,
    SUBSCRIBE_ALL_AUDIT_SERVICE,
  ]) {
    assert.ok(
      !wc.includes("command"),
      `Subscribe wildcard ${wc} should not match command topics`,
    );
  }
});
