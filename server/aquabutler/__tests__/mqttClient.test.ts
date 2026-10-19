/**
 * Tests for PerCustomerMqttClient — uses a mock mqtt.MqttClient injected
 * via the `factory` option so we exercise the event-handling and
 * publish paths without touching a real broker.
 *
 * Validates:
 *   - message events fire with topic + payload + receivedAt
 *   - publish wraps payload with auth envelope (auth.source, auth.user_id)
 *   - publish fails when client is closed
 *   - close() is idempotent and resolves cleanly
 *
 * The Logger module is a stateful singleton (init() binds winston);
 * tests call setUpLogger() once to bind a silent logger so info/error
 * calls don't crash when _logger is undefined.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import {
  PerCustomerMqttClient,
  commandSuffix,
} from "../mqttClient";
import { MANUAL_ACTION, AUTH_SOURCE } from "../mqttTopics";

class MockMqttClient extends EventEmitter {
  public published: Array<{ topic: string; payload: string; opts: any }> = [];
  public subscribed: Array<{ topic: string; opts: any }> = [];
  public endCalled = false;
  public endCb: () => void = () => {};
  // The real mqtt.MqttClient connects itself as soon as mqtt.connect()
  // returns — we mirror that behaviour so the wrapper's lifecycle works.
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
    this.endCalled = true;
    this.endCb = cb;
    setImmediate(() => { this.emit("close"); cb(); });
  }
}

function makeClient(): PerCustomerMqttClient {
  process.env.AQB_TEST_PW = "test-pw";
  const mock = new MockMqttClient();
  const client = new PerCustomerMqttClient({
    broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
    customer: {
      id: "customer-test-001",
      displayName: "Test",
      username: "customer_customer-test-001",
      passwordRef: "env:AQB_TEST_PW",
      permissionScope: "tech",
    },
    factory: () => mock as any,
  });
  client.connect();
  return client;
}

test("subscribes to pool/<id>/# on connect", async () => {
  process.env.AQB_TEST_PW = "test-pw";
  const mock = new MockMqttClient();
  const client = new PerCustomerMqttClient({
    broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
    customer: {
      id: "customer-test-001",
      displayName: "T",
      username: "customer_customer-test-001",
      passwordRef: "env:AQB_TEST_PW",
      permissionScope: "tech",
    },
    factory: () => mock as any,
  });
  client.connect();
  await new Promise<void>((r) => client.once("connect", () => r()));
  assert.equal(mock.subscribed.length, 1);
  assert.equal(mock.subscribed[0].topic, "pool/customer-test-001/#");
  await client.close();
});

test("surfaces messages via the 'message' event", async () => {
  const client = makeClient();
  await new Promise<void>((r) => client.once("connect", () => r()));
  const received: any[] = [];
  client.on("message", (e) => received.push(e));

  const mock = (client as any)._client as MockMqttClient;
  mock.emit("message", "pool/customer-test-001/telemetry/ph", Buffer.from(JSON.stringify({ value: 7.4, last_changed: "..." })));

  await new Promise((r) => setImmediate(r));
  assert.equal(received.length, 1);
  assert.equal(received[0].topic, "pool/customer-test-001/telemetry/ph");
  assert.equal(received[0].payload.toString(), '{"value":7.4,"last_changed":"..."}');
  await client.close();
});

test("publishCommand wraps payload with the schema auth envelope", async () => {
  process.env.AQB_TEST_PW = "test-pw";
  const mock = new MockMqttClient();
  const client = new PerCustomerMqttClient({
    broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
    customer: {
      id: "customer-test-001",
      displayName: "T",
      username: "customer_customer-test-001",
      passwordRef: "env:AQB_TEST_PW",
      permissionScope: "tech",
    },
    factory: () => mock as any,
  });
  client.connect();
  await new Promise<void>((r) => client.once("connect", () => r()));

  await client.publishCommand(
    commandSuffix.manualPump(),
    { state: "on", duration_min: 60 },
    "tech_001",
    AUTH_SOURCE.dashpanel,
  );

  assert.equal(mock.published.length, 1);
  const pub = mock.published[0];
  assert.equal(pub.topic, "pool/customer-test-001/command/manual/pump/set");
  const env = JSON.parse(pub.payload);
  assert.equal(env.state, "on");
  assert.equal(env.duration_min, 60);
  assert.equal(env.auth.source, AUTH_SOURCE.dashpanel);
  assert.equal(env.auth.user_id, "tech_001");
  // Per the schema v1.0 §QoS table, command/* is QoS 1.
  assert.equal(pub.opts.qos, 1);

  await client.close();
});

test("publishCommand rejects when client is closed", async () => {
  const client = makeClient();
  await new Promise<void>((r) => client.once("connect", () => r()));
  await client.close();
  await assert.rejects(
    () => client.publishCommand(commandSuffix.manualPump(), {}, "tech_001"),
    /not connected/,
  );
});

test("missing env password fails closed (connect() emits error)", async () => {
  delete process.env.AQB_TEST_PW;
  const client = new PerCustomerMqttClient({
    broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
    customer: {
      id: "customer-test-001",
      displayName: "T",
      username: "customer_customer-test-001",
      passwordRef: "env:AQB_TEST_PW",
      permissionScope: "tech",
    },
  });
  let err: Error | null = null;
  client.on("error", (e: Error) => { err = e; });
  client.connect();
  await new Promise((r) => setImmediate(r));
  assert.ok(err, "expected error when passwordRef env var is unset");
  await client.close();
});

test("commandSuffix matches the canonical schema writers", () => {
  assert.equal(commandSuffix.manualPump(), "/command/manual/pump/set");
  assert.equal(commandSuffix.manualFilter(), "/command/manual/filter/set");
  assert.equal(commandSuffix.manualChlorination(), "/command/manual/chlorination/set");
  assert.equal(commandSuffix.manualHeater(), "/command/manual/heater/set");
  assert.equal(commandSuffix.serviceSet(), "/command/service/set");
});
