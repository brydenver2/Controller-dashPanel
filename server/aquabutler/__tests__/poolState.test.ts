/**
 * Tests for the in-memory pool state store.
 *
 * Validates:
 *   - last-value-wins semantics per topic
 *   - envelope unwrap (schema v1.0 wraps payload as `{value, last_changed}`)
 *   - cross-customer isolation (a message from a different customer
 *     than the active one is silently dropped)
 *   - reset() behaviour on customer switch
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PoolStateStore } from "../poolState";

test("applies messages for the active customer only", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");

  assert.equal(store.applyMessage("pool/abc-1234/telemetry/ph", { value: 7.4, last_changed: "2026-10-18T16:30:00Z" }), true);
  assert.equal(store.applyMessage("pool/different-customer/telemetry/ph", { value: 8.0, last_changed: "..." }), false);

  const snap = store.current;
  assert.equal(snap.telemetry.ph, 7.4, "should keep our customer's value");
});

test("parses telemetry, status, health group/leaf from topic", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  store.applyMessage("pool/abc-1234/telemetry/orp_mV", { value: 685, last_changed: "..." });
  store.applyMessage("pool/abc-1234/status/mode", { value: "auto", last_changed: "..." });
  store.applyMessage("pool/abc-1234/health/comm", { value: { mqtt_connected: true, last_msg_s: 12 }, last_changed: "..." });
  const snap = store.current;
  assert.equal(snap.telemetry.orp_mV, 685);
  assert.equal(snap.status.mode, "auto");
  assert.deepEqual(snap.health.comm, { mqtt_connected: true, last_msg_s: 12 });
});

test("unwraps the {value, last_changed} envelope per schema v1.0", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  store.applyMessage("pool/abc-1234/telemetry/ph", { value: 7.6, last_changed: "..." });
  const snap = store.current;
  assert.equal(snap.telemetry.ph, 7.6, "should be unwrapped scalar, not envelope object");
});

test("passes through non-envelope payloads as-is", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  store.applyMessage("pool/abc-1234/health/comm", { mqtt_connected: false });
  const snap = store.current;
  assert.deepEqual(snap.health.comm, { mqtt_connected: false });
});

test("reset clears state on customer switch (no leak)", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  store.applyMessage("pool/abc-1234/telemetry/ph", { value: 7.4, last_changed: "..." });
  assert.equal(store.current.telemetry.ph, 7.4);

  store.setActiveCustomer("different");
  store.applyMessage("pool/different/telemetry/ph", { value: 8.0, last_changed: "..." });
  const snap = store.current;
  assert.equal(snap.telemetry.ph, 8.0, "fresh state for the new customer");
});

test("emits 'changed' for every applied message", () => {
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  const events: any[] = [];
  store.on("changed", (e: any) => events.push(e));
  store.applyMessage("pool/abc-1234/telemetry/ph", { value: 7.4, last_changed: "..." });
  store.applyMessage("pool/other/telemetry/ph", { value: 8.0, last_changed: "..." });
  assert.equal(events.length, 1);
  assert.equal(events[0].group, "telemetry");
  assert.equal(events[0].leaf, "ph");
});

test("supports the schema v1.0 chem/dosing/config/audit groups (Layer 2 readiness)", () => {
  // Bug fix: previously only 5 groups were pre-initialised, so chem /
  // dosing / config / audit messages were silently dropped. The store
  // must accept every read-side group from the canonical schema so
  // Layer 2 widgets work without touching the state code.
  const store = new PoolStateStore();
  store.setActiveCustomer("abc-1234");
  assert.equal(
    store.applyMessage("pool/abc-1234/chem/orp", { value: 685, unit: "mV", probe_id: "main", ts: "..." }),
    true,
  );
  assert.equal(
    store.applyMessage("pool/abc-1234/dosing/chlorine", { chemical: "chlorine", amount_ml: 12.5, success: true, ts: "..." }),
    true,
  );
  assert.equal(
    store.applyMessage("pool/abc-1234/config/pump.speed", { value: "3000", ts: "...", set_by: "njsPC" }),
    true,
  );
  assert.equal(
    store.applyMessage("pool/abc-1234/audit/manual", { ts: "...", action: "pump_on", params: {}, source: "rotary_display" }),
    true,
  );
  const snap = store.current;
  assert.equal(snap.chem.orp, 685);
  assert.equal((snap.dosing.chlorine as any).chemical, "chlorine");
  assert.equal(snap.config["pump.speed"], "3000");
  assert.equal((snap.audit.manual as any).action, "pump_on");
});
