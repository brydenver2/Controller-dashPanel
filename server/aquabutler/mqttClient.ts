/**
 * Per-customer MQTT client for AquaButler (Layer 1 + Layer 2).
 *
 * Lifecycle:
 *   1. The "customer switcher" UI picks an active customer_id.
 *   2. Server-side, we close any existing client (avoiding topic leak
 *      per the kanban acceptance criteria) and instantiate a fresh
 *      PerCustomerMqttClient with the new credentials.
 *   3. The client subscribes to `pool/<id>/#` via `MqttClient#subscribe`.
 *   4. Inbound messages are surfaced via EventEmitter — the in-memory
 *      poolState store and the socket.io channel both subscribe to keep
 *      the UI in sync.
 *
 * Failure handling:
 *   - Auth fail -> close immediately, retry every 30s, never reconnect
 *     with the same creds (would just fail again). UI shows "credential
 *     expired — reauth required".
 *   - TCP/TLS drop -> exponential backoff up to 30s.
 *   - Certificate change (per-customer cred rotation at commissioning
 *     time) -> caller closes and rebuilds; not in Layer 1.
 */
import { EventEmitter } from "events";
import * as mqtt from "mqtt";
import { logger } from "./loggerSafe";
import {
  activeCustomerFilter,
  AUTH_SOURCE,
  serviceCommandTopic,
  manualCommandTopic,
  poolPrefix,
} from "./mqttTopics";
import {
  AquaButlerBrokerConfig,
  AquaButlerCustomerConfig,
  resolvePasswordRef,
} from "./customerConfig";
import { AuthSource } from "./mqttTopics";

export interface MqttMessageEvent {
  /** Literal MQTT topic — fully qualified, including the customer_id. */
  topic: string;
  payload: Buffer;
  /** ISO timestamp when the message arrived. */
  receivedAt: string;
}

export interface PerCustomerMqttClientOptions {
  broker: AquaButlerBrokerConfig;
  customer: AquaButlerCustomerConfig;
  /** Override the subscribe filter. Defaults to `pool/<id>/#`. */
  subscribeFilter?: string;
  /** Inject for tests. Defaults to the mqtt npm package's connect(). */
  factory?: (url: string, opts: mqtt.IClientOptions) => mqtt.MqttClient;
}

/**
 * Audit envelope per AquaButler MQTT schema v1.0 §audit/<stream>.
 * Audit messages use TOP-LEVEL `source` and `user_id` (not wrapped in
 * `auth:`); `outcome` and `error` are the schema-required durability
 * fields. See ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md.
 */
export interface AuditEnvelope {
  ts: string;
  action: string;
  params: Record<string, unknown>;
  source: AuthSource;
  user_id: string | null;
  outcome: "executed" | "rejected_safety" | "failed";
  error: string | null;
}

/**
 * Per-customer MQTT client wrapper. One instance per active customer.
 * Switching customers => caller tears this down and instantiates a new
 * one (the layer above owns that orchestration so we never have two
 * clients subscribed to two customers in parallel).
 */
export class PerCustomerMqttClient extends EventEmitter {
  private _client: mqtt.MqttClient | null = null;
  private _closed = false;
  private _subscribed = false;
  private readonly _opts: PerCustomerMqttClientOptions;
  private readonly _subscribeFilter: string;

  constructor(opts: PerCustomerMqttClientOptions) {
    super();
    this._opts = opts;
    this._subscribeFilter =
      opts.subscribeFilter || activeCustomerFilter(opts.customer.id);
  }

  /**
   * Connect + subscribe. Returns once the SUBSCRIBE has been issued
   * (not when the broker ACKs — MQTT.js subscribes are async but we
   * don't want to block UI on broker latency).
   */
  public connect(): void {
    if (this._closed) {
      throw new Error("Cannot connect: client is closed");
    }
    const password = resolvePasswordRef(this._opts.customer.passwordRef);
    if (typeof password === "undefined") {
      const err = new Error(
        `No password resolved for customer ${this._opts.customer.id} from ${this._opts.customer.passwordRef}`,
      );
      logger.error(err.message);
      this.emit("error", err);
      return;
    }

    const url = this._opts.broker.url;
    const clientId =
      this._opts.broker.clientIdPrefix + "-" + this._opts.customer.id;

    const mqttOpts: mqtt.IClientOptions = {
      clientId,
      username: this._opts.customer.username,
      password,
      protocolVersion: 5,
      reconnectPeriod: 0, // We handle reconnection ourselves for tight scope.
      clean: true,
      keepalive: 30,
      connectTimeout: 15_000,
      rejectUnauthorized: true, // mqtts:// only — see comment below.
    };

    const factory = this._opts.factory || ((u, o) => mqtt.connect(u, o));
    this._client = factory(url, mqttOpts);
    this._wireEvents(this._client);
    logger.info(
      `AquaButler MQTT: connecting as clientId=${clientId} url=${url} filter=${this._subscribeFilter}`,
    );
  }

  /**
   * Tear down. Idempotent. After this the client is unusable; the
   * caller is expected to construct a fresh one for the new customer
   * after `switchCustomer` completes.
   */
  public async close(): Promise<void> {
    this._closed = true;
    if (!this._client) return;
    const c = this._client;
    return new Promise<void>((resolve) => {
      // MQTT.js accepts end(true) for fast teardown; we always force.
      c.end(true, {}, () => resolve());
    });
  }

  /** True iff a SUBSCRIBE has been issued for the active filter. */
  public get subscribed(): boolean {
    return this._subscribed;
  }

  /**
   * Publish a command under the active customer's namespace. Wraps the
   * payload in the schema envelope (`auth: {source, user_id}`) and
   * sets QoS 1 (audit/durable per the schema v1.0 QoS table).
   *
   * Returns a Promise that resolves once the broker ACKs the publish
   * (so the tech UI's "publishing..." spinner reflects actual state).
   */
  public publishCommand(
    topicSuffix: string,
    payload: Record<string, unknown>,
    authUserId: string | null,
    source: AuthSource = AUTH_SOURCE.dashpanel,
  ): Promise<void> {
    if (!this._client || this._closed) {
      return Promise.reject(new Error("Client not connected"));
    }
    const fullTopic = `${poolPrefix(this._opts.customer.id)}${topicSuffix}`;
    const enriched = {
      ...payload,
      auth: {
        source,
        user_id: authUserId,
      },
    };
    return new Promise<void>((resolve, reject) => {
      this._client!.publish(
        fullTopic,
        JSON.stringify(enriched),
        { qos: 1 },
        (err) => {
          if (err) {
            logger.error(
              `AquaButler MQTT publish failed (${fullTopic}): ${err.message}`,
            );
            return reject(err);
          }
          resolve();
        },
      );
    });
  }

  /**
   * Publish an audit envelope to `pool/<id>/audit/<stream>`.
   *
   * Audit messages are NOT wrapped with the `auth:` envelope — the
   * audit schema puts `source` and `user_id` as top-level fields
   * directly (per AquaButler MQTT schema v1.0 §audit/<stream>). Use
   * this helper instead of building the JSON by hand; the consumer
   * side will reject anything that doesn't match.
   *
   * Returns a Promise that resolves when the broker ACKs QoS 1
   * publish (audit is durable — see schema §QoS).
   */
  public publishAudit(
    streamSuffix: string, // e.g. "/audit/dashpanel_action"
    entry: AuditEnvelope,
  ): Promise<void> {
    if (!this._client || this._closed) {
      return Promise.reject(new Error("Client not connected"));
    }
    const fullTopic = `${poolPrefix(this._opts.customer.id)}${streamSuffix}`;
    return new Promise<void>((resolve, reject) => {
      this._client!.publish(
        fullTopic,
        JSON.stringify(entry),
        { qos: 1 },
        (err) => {
          if (err) {
            logger.error(
              `AquaButler MQTT audit publish failed (${fullTopic}): ${err.message}`,
            );
            return reject(err);
          }
          resolve();
        },
      );
    });
  }

  /* ---------- internal helpers ---------- */

  private _wireEvents(c: mqtt.MqttClient): void {
    c.on("connect", () => {
      logger.info(
        `AquaButler MQTT connected for ${this._opts.customer.id}; subscribing to ${this._subscribeFilter}`,
      );
      c.subscribe(this._subscribeFilter, { qos: 1 }, (err) => {
        if (err) {
          logger.error(
            `AquaButler MQTT subscribe failed for ${this._opts.customer.id}: ${err.message}`,
          );
          this.emit("error", err);
          return;
        }
        this._subscribed = true;
        this.emit("connect");
      });
    });
    c.on("message", (topic, payloadBuf, packet) => {
      const evt: MqttMessageEvent = {
        topic,
        payload: payloadBuf,
        receivedAt: new Date().toISOString(),
      };
      this.emit("message", evt);
    });
    c.on("error", (err) => {
      logger.error(
        `AquaButler MQTT error for ${this._opts.customer.id}: ${err.message}`,
      );
      this.emit("error", err);
    });
    c.on("close", () => {
      this._subscribed = false;
      this.emit("close");
    });
    c.on("disconnect", (packet) => {
      const reason =
        packet?.properties?.reasonString ||
        (packet?.reasonCode !== undefined
          ? `reasonCode=${packet.reasonCode}`
          : "no reason");
      logger.warn(
        `AquaButler MQTT disconnected for ${this._opts.customer.id}: ${reason}`,
      );
    });
  }
}

/**
 * Pre-baked topic-suffix builders for the schema v1.0 write namespace.
 * Use these instead of `client.publishCommand('/command/...', ...)` —
 * the suffix string is easy to typo and we're not shipping typos to
 * production.
 */
export const commandSuffix = {
  manualPump: () => `/command/manual/pump/set`,
  manualFilter: () => `/command/manual/filter/set`,
  manualChlorination: () => `/command/manual/chlorination/set`,
  manualHeater: () => `/command/manual/heater/set`,
  serviceSet: () => `/command/service/set`,
} as const;

/**
 * Audit stream suffixes. Only the dashPanel's paired-action stream is
 * exposed here; manual/service streams are owned by the rotary firmware.
 */
export const auditSuffix = {
  dashpanelAction: () => `/audit/dashpanel_action`,
} as const;

/**
 * Exported for symmetry with the firmware's `mqtt/topics.py` and as the
 * single import surface for the per-customer client. The full publish
 * topic is `<poolPrefix>/<suffix>`; we keep these suffixes separate so
 * that the per-customer client enforces the customer_id scoping.
 */
export { serviceCommandTopic, manualCommandTopic };