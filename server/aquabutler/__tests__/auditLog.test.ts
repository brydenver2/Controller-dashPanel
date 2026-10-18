/**
 * Tests for the per-customer rolling audit log buffer.
 *
 * Validates:
 *   - capacity-bounded retention per stream
 *   - scope: only active customer's topics are accepted
 *   - schema envelope validation (malformed payloads are dropped)
 *   - reverse-chronological merging across streams
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditLogStore } from "../auditLog";

function mkEntry(
  ts: string,
  action: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ts,
    action,
    params: {},
    source: "rotary_display" as const,
    user_id: null,
    outcome: "executed" as const,
    error: null,
    ...overrides,
  };
}

test("AuditLogStore: scope guards against cross-customer topics", () => {
  const store = new AuditLogStore();
  store.setActiveCustomer("aaaaaaaa-1111");
  const accepted = store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    mkEntry("2026-10-18T12:00:00Z", "pump_on"),
  );
  assert.equal(accepted, true);
  // Different customer_id prefix -> dropped (defense in depth).
  const rejected = store.appendFromMessage(
    "pool/bbbbbbbb-2222/audit/manual",
    mkEntry("2026-10-18T12:00:01Z", "pump_off"),
  );
  assert.equal(rejected, false);
  assert.equal(store.size(), 1);
});

test("AuditLogStore: rejects malformed envelopes", () => {
  const store = new AuditLogStore();
  store.setActiveCustomer("aaaaaaaa-1111");
  // missing ts
  const r1 = store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    { action: "pump_on", params: {}, source: "rotary_display" },
  );
  assert.equal(r1, false);
  // params is a string instead of object
  const r2 = store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    { ts: "2026-10-18T12:00:00Z", action: "pump_on", params: "nope", source: "rotary_display" },
  );
  assert.equal(r2, false);
  assert.equal(store.size(), 0);
});

test("AuditLogStore: capacity enforced per stream", () => {
  const store = new AuditLogStore({ capacity: 3 });
  store.setActiveCustomer("aaaaaaaa-1111");
  for (let i = 0; i < 5; i++) {
    store.appendFromMessage(
      "pool/aaaaaaaa-1111/audit/manual",
      mkEntry(`2026-10-18T12:00:0${i}Z`, "pump_on"),
    );
  }
  assert.equal(store.size(), 3, "only the 3 most recent retained");
  const recent = store.recent({ limit: 100 });
  assert.equal(recent.length, 3);
  // Reverse-chronological order
  assert.equal(recent[0].ts, "2026-10-18T12:00:04Z");
  assert.equal(recent[2].ts, "2026-10-18T12:00:02Z");
});

test("AuditLogStore: merges multiple streams reverse-chronologically", () => {
  const store = new AuditLogStore();
  store.setActiveCustomer("aaaaaaaa-1111");
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    mkEntry("2026-10-18T12:00:01Z", "pump_on"),
  );
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/service",
    mkEntry("2026-10-18T12:00:03Z", "service_enter"),
  );
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/dashpanel_action",
    mkEntry("2026-10-18T12:00:02Z", "chlorination_override"),
  );
  const recent = store.recent();
  assert.equal(recent.length, 3);
  assert.equal(recent[0].action, "service_enter");
  assert.equal(recent[1].action, "chlorination_override");
  assert.equal(recent[2].action, "pump_on");
});

test("AuditLogStore: setActiveCustomer clears the buffer", () => {
  const store = new AuditLogStore();
  store.setActiveCustomer("aaaaaaaa-1111");
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    mkEntry("2026-10-18T12:00:00Z", "pump_on"),
  );
  assert.equal(store.size(), 1);
  store.setActiveCustomer("bbbbbbbb-2222");
  assert.equal(store.size(), 0);
});

test("AuditLogStore: stream filter scopes query", () => {
  const store = new AuditLogStore();
  store.setActiveCustomer("aaaaaaaa-1111");
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/manual",
    mkEntry("2026-10-18T12:00:00Z", "pump_on"),
  );
  store.appendFromMessage(
    "pool/aaaaaaaa-1111/audit/service",
    mkEntry("2026-10-18T12:00:01Z", "service_enter"),
  );
  const manualOnly = store.recent({ stream: "manual" });
  assert.equal(manualOnly.length, 1);
  assert.equal(manualOnly[0].stream, "manual");
});

test("AuditLogStore: offset + limit pagination", () => {
  const store = new AuditLogStore({ capacity: 10 });
  store.setActiveCustomer("aaaaaaaa-1111");
  for (let i = 0; i < 5; i++) {
    store.appendFromMessage(
      "pool/aaaaaaaa-1111/audit/manual",
      mkEntry(`2026-10-18T12:00:0${i}Z`, `a${i}`),
    );
  }
  const page1 = store.recent({ limit: 2, offset: 0 });
  const page2 = store.recent({ limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.equal(page1[0].action, "a4");
  assert.equal(page2[0].action, "a2");
});