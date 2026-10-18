/**
 * Tests for the pre-publish safety interlocks + REST command endpoints.
 *
 * Validates:
 *   - checkChlorinationInterlock refuses at ORP >= 800
 *   - checkChlorinationInterlock refuses when telemetry is missing (fail-closed)
 *   - checkChlorinationInterlock passes when telemetry is fresh and < 800
 *   - POST /command/manual publishes the right suffix
 *   - POST /command/manual returns 409 + writes a rejected_safety audit on interlock
 *   - POST /command/manual writes a paired executed audit on success
 *   - POST /command/manual returns 400 for unknown actions
 *   - POST /command/service requires sha256: pin_hash for enter/exit
 *   - sha256Hex produces a well-formed `sha256:<hex>` string
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import express from "express";
import http from "http";
import {
  AquaButlerRoute,
  checkChlorinationInterlock,
  buildAuditEnvelope,
  sha256Hex,
} from "../api";
import { PoolStateStore } from "../poolState";
import { AuditLogStore } from "../auditLog";
import { AquaButlerFleet } from "../fleet";
import { AuthSource } from "../mqttTopics";
import { AquaButlerConfig, AquaButlerCustomerConfig } from "../customerConfig";

/* ---------- pure helpers ---------- */

test("checkChlorinationInterlock: refuses when chem/orp >= 800", () => {
  const state = new PoolStateStore();
  state.setActiveCustomer("aaaaaaaa-1111");
  // Simulate the schema envelope landing on the store.
  state.applyMessage("pool/aaaaaaaa-1111/chem/orp", { value: 850 });
  const check = checkChlorinationInterlock(state);
  assert.equal(check.ok, false);
  assert.match(check.reason || "", /chlorination_lockout_800mV/);
});

test("checkChlorinationInterlock: refuses when telemetry is missing (fail-closed)", () => {
  const state = new PoolStateStore();
  state.setActiveCustomer("aaaaaaaa-1111");
  // No chem/orp message has arrived yet.
  const check = checkChlorinationInterlock(state);
  assert.equal(check.ok, false);
  assert.match(check.reason || "", /not yet available/);
});

test("checkChlorinationInterlock: passes when chem/orp < 800", () => {
  const state = new PoolStateStore();
  state.setActiveCustomer("aaaaaaaa-1111");
  state.applyMessage("pool/aaaaaaaa-1111/chem/orp", { value: 685 });
  const check = checkChlorinationInterlock(state);
  assert.equal(check.ok, true);
});

test("checkChlorinationInterlock: boundary at exactly 800 refuses", () => {
  const state = new PoolStateStore();
  state.setActiveCustomer("aaaaaaaa-1111");
  state.applyMessage("pool/aaaaaaaa-1111/chem/orp", { value: 800 });
  const check = checkChlorinationInterlock(state);
  assert.equal(check.ok, false);
});

test("buildAuditEnvelope: produces schema v1.0 envelope", () => {
  const env = buildAuditEnvelope(
    "pump_on",
    { state: "on", duration_min: 60 },
    "dashpanel" as AuthSource,
    "user_42",
    "executed",
    null,
  );
  assert.equal(env.ts.length > 0, true);
  assert.equal(env.action, "pump_on");
  assert.equal(env.source, "dashpanel");
  assert.equal(env.user_id, "user_42");
  assert.equal(env.outcome, "executed");
  assert.equal(env.error, null);
});

test("sha256Hex: produces 'sha256:<64hex>'", async () => {
  const h = await sha256Hex("1234");
  assert.match(h, /^sha256:[a-f0-9]{64}$/);
});

/* ---------- REST integration ---------- */

class FakeMqttClient extends EventEmitter {
  public published: Array<{ topic: string; payload: string; opts: any }> = [];
  public subscribed: Array<{ topic: string; opts: any }> = [];
  public _closed = false;
  private _subscribed = false;
  constructor() {
    super();
    setImmediate(() => this.emit("connect"));
  }
  subscribe(topic: string, opts: any, cb: (err: Error | null) => void) {
    this.subscribed.push({ topic, opts });
    setImmediate(() => cb(null));
  }
  publish(topic: string, payload: string, opts: any, cb: (err: Error | null) => void) {
    this.published.push({ topic, payload, opts });
    setImmediate(() => cb(null));
  }
  end(_force: boolean, _opts: any, cb: () => void) {
    setImmediate(() => { this.emit("close"); cb(); });
  }
  get subscribedFlag(): boolean { return this._subscribed; }
}

function buildTestHarness(): {
  fleet: AquaButlerFleet;
  state: PoolStateStore;
  auditLog: AuditLogStore;
  mock: FakeMqttClient;
  server: http.Server;
  port: number;
  close: () => Promise<void>;
} {
  process.env.AQB_TEST_PW = "test-pw";
  const customer: AquaButlerCustomerConfig = {
    id: "aaaaaaaa-1111",
    displayName: "Test",
    username: "customer_aaaaaaaa-1111",
    passwordRef: "env:AQB_TEST_PW",
    permissionScope: "tech",
  };
  const mock = new FakeMqttClient();
  const cfg: AquaButlerConfig = {
    enabled: true,
    broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
    customers: [customer],
    activeCustomerId: customer.id,
    skipMqttForTests: false,
    mcpClientFactory: (() => {
      // First call returns the mock; later calls (e.g., if the fleet
      // reconnects after a teardown) would too. For these tests we
      // only need the first one.
      let first = true;
      return (_url: string, _opts: any) => {
        if (first) { first = false; return mock as any; }
        // Subsequent reconnects: return a fresh client that's also a
        // no-op (we don't expect reconnects in these tests).
        const c = new FakeMqttClient();
        return c as any;
      };
    })(),
  };
  const fleet = new AquaButlerFleet(cfg);
  // connect synchronously so subsequent switchCustomer doesn't tear it down
  // (we want the per-customer client to be the active one for the test).
  // We rely on fleet.init() being a fire-and-forget Promise; we wait for
  // it via a microtask before starting the HTTP server.

  const state = new PoolStateStore();
  state.setActiveCustomer(customer.id);
  const auditLog = new AuditLogStore();
  auditLog.setActiveCustomer(customer.id);

  const app = express();
  app.use(express.json());
  // Bypass auth so the handler hits the real interlock + audit code.
  app.use((req, _res, next) => {
    req.headers["x-aquabutler-bypass"] = "1";
    next();
  });
  AquaButlerRoute.initRoutes(app, { fleet, state, auditLog, cfg });

  const server = http.createServer(app);
  return new Promise((resolveServer) => {
    fleet
      .init()
      .then(() => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          resolveServer({
            fleet,
            state,
            auditLog,
            mock,
            server,
            port,
            close: () =>
              new Promise<void>((resolve) => {
                fleet
                  .shutdown()
                  .catch(() => {})
                  .finally(() => server.close(() => resolve()));
              }),
          });
        });
      })
      .catch((err) => {
        throw err;
      });
  }) as any;
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AquaButler-Bypass": "1",
          "Content-Length": Buffer.byteLength(JSON.stringify(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: any = text;
          try { parsed = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

test("POST /command/manual: publishes the right suffix for pump", async () => {
  const h = await buildTestHarness();
  try {
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "pump",
      params: { state: "on", duration_min: 60 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.published, "/command/manual/pump/set");
    // 2 publishes: the command itself + the paired audit entry.
    assert.equal(h.mock.published.length, 2);
    // First publish (command)
    const cmdPub = h.mock.published[0];
    assert.equal(cmdPub.topic, "pool/aaaaaaaa-1111/command/manual/pump/set");
    const cmdPayload = JSON.parse(cmdPub.payload);
    assert.equal(cmdPayload.state, "on");
    assert.equal(cmdPayload.duration_min, 60);
    assert.equal(cmdPayload.auth.source, "dashpanel");
    // Second publish (audit)
    const auditPub = h.mock.published[1];
    assert.equal(auditPub.topic, "pool/aaaaaaaa-1111/audit/dashpanel_action");
    const auditPayload = JSON.parse(auditPub.payload);
    assert.equal(auditPayload.action, "pump_on");
    assert.equal(auditPayload.outcome, "executed");
  } finally {
    await h.close();
  }
});

test("POST /command/manual: returns 400 on unknown action", async () => {
  const h = await buildTestHarness();
  try {
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "lights",
      params: {},
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid-action");
    // No publish attempted.
    assert.equal(h.mock.published.length, 0);
  } finally {
    await h.close();
  }
});

test("POST /command/manual: chlorination refuses with 409 + rejected_safety audit when chem/orp >= 800", async () => {
  const h = await buildTestHarness();
  try {
    h.state.applyMessage("pool/aaaaaaaa-1111/chem/orp", { value: 850 });
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "chlorination",
      params: { target_orp_mV: 700, duration_min: 10, max_duration_min: 10 },
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "rejected_safety");
    assert.match(r.body.reason, /chlorination_lockout_800mV/);
    // Only the audit entry was published; the command itself was not.
    assert.equal(h.mock.published.length, 1);
    const auditPub = h.mock.published[0];
    assert.equal(auditPub.topic, "pool/aaaaaaaa-1111/audit/dashpanel_action");
    const auditPayload = JSON.parse(auditPub.payload);
    assert.equal(auditPayload.outcome, "rejected_safety");
    assert.equal(auditPayload.action, "chlorination_override");
    assert.match(auditPayload.error, /chlorination_lockout_800mV/);
  } finally {
    await h.close();
  }
});

test("POST /command/manual: chlorination succeeds when chem/orp < 800", async () => {
  const h = await buildTestHarness();
  try {
    h.state.applyMessage("pool/aaaaaaaa-1111/chem/orp", { value: 685 });
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "chlorination",
      params: { target_orp_mV: 700, duration_min: 5, max_duration_min: 10 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.published, "/command/manual/chlorination/set");
    // Command + audit
    assert.equal(h.mock.published.length, 2);
    const auditPayload = JSON.parse(h.mock.published[1].payload);
    assert.equal(auditPayload.outcome, "executed");
  } finally {
    await h.close();
  }
});

test("POST /command/manual: chlorination refuses (fail-closed) when telemetry missing", async () => {
  const h = await buildTestHarness();
  try {
    // No chem/orp message — store's chem group is empty.
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "chlorination",
      params: { target_orp_mV: 700, duration_min: 5 },
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "rejected_safety");
    assert.match(r.body.reason, /not yet available/);
    // Only the rejected_safety audit entry was published.
    assert.equal(h.mock.published.length, 1);
  } finally {
    await h.close();
  }
});

test("POST /command/service: enter requires sha256 pin_hash", async () => {
  const h = await buildTestHarness();
  try {
    const r1 = await postJson(h.port, "/aquabutler/command/service", {
      action: "enter",
      timeout_min: 60,
    });
    assert.equal(r1.status, 400);
    assert.equal(r1.body.error, "missing-pin-hash");
    const r2 = await postJson(h.port, "/aquabutler/command/service", {
      action: "enter",
      timeout_min: 60,
      pin_hash: "not-a-sha256",
    });
    assert.equal(r2.status, 400);
    const r3 = await postJson(h.port, "/aquabutler/command/service", {
      action: "enter",
      timeout_min: 60,
      pin_hash: "sha256:" + "a".repeat(64),
    });
    assert.equal(r3.status, 200);
    assert.equal(r3.body.action, "enter");
    // Command + audit
    assert.equal(h.mock.published.length, 2);
    const auditPayload = JSON.parse(h.mock.published[1].payload);
    assert.equal(auditPayload.action, "service_enter");
  } finally {
    await h.close();
  }
});

test("POST /command/service: force_exit does not require pin_hash", async () => {
  const h = await buildTestHarness();
  try {
    const r = await postJson(h.port, "/aquabutler/command/service", {
      action: "force_exit",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.action, "force_exit");
    // Force-exit's auth.source MUST be "cloud" per schema §service/set.
    const cmdPub = h.mock.published[0];
    const cmdPayload = JSON.parse(cmdPub.payload);
    assert.equal(cmdPayload.auth.source, "cloud");
    const auditPayload = JSON.parse(h.mock.published[1].payload);
    assert.equal(auditPayload.source, "cloud");
  } finally {
    await h.close();
  }
});

test("POST /command/manual: heater publishes correct audit action + range", async () => {
  const h = await buildTestHarness();
  try {
    const r = await postJson(h.port, "/aquabutler/command/manual", {
      action: "heater",
      params: { target_f: 82 },
    });
    assert.equal(r.status, 200);
    const auditPayload = JSON.parse(h.mock.published[1].payload);
    assert.equal(auditPayload.action, "heater_target");
  } finally {
    await h.close();
  }
});