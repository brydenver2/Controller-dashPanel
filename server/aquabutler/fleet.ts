/**
 * AquaButler fleet — one active customer at a time.
 *
 * Owns the single `PerCustomerMqttClient` for the currently-selected
 * customer. Switching customers tears down the old client before
 * instantiating the new one (so no `pool/<id_A>/#` messages leak
 * into a session for `id_B`). The UI invokes this via a Socket.IO
 * RPC; the rest of the UI subscribes to the `aquabutler/state` event
 * for live updates.
 *
 * Why one client at a time (not N):
 *   - Mosquitto per-customer ACL expects one connection per customer
 *     (the `customer_<id>` user doesn't have permissions for other
 *     customers — a multi-customer single connection would be
 *     architecturally wrong).
 *   - Tech UI is one-customer-at-a-time (kanban acceptance criteria:
 *     "no leak between customers").
 *   - Multiple parallel clients per dashboard session would
 *     complicate the "at-a-glance status sidebar" use case (Layer 2).
 *
 * Layer 1: only the currently-active customer is connected.
 * Layer 2+: the customer sidebar widget (Layer 2 item 9) can subscribe
 * to `health/system` summaries via a separate read-only monitoring
 * account — out of scope for this commit.
 */
import { EventEmitter } from "events";
import { logger } from "./loggerSafe";
import {
  AquaButlerConfig,
  AquaButlerCustomerConfig,
  loadAquaButlerConfig,
} from "./customerConfig";
import {
  MqttMessageEvent,
  PerCustomerMqttClient,
  PerCustomerMqttClientOptions,
} from "./mqttClient";

export interface ActiveCustomerChangedEvent {
  previousCustomerId: string | null;
  currentCustomerId: string | null;
  reason: "user-switch" | "config-change" | "shutdown" | "init";
}

export class AquaButlerFleet extends EventEmitter {
  private _cfg: AquaButlerConfig;
  private _activeClient: PerCustomerMqttClient | null = null;
  private _activeCustomerId: string | null = null;
  private _closed = false;

  constructor(cfg?: AquaButlerConfig) {
    super();
    this._cfg = cfg || loadAquaButlerConfig();
  }

  /** Returns the currently-active customer, or null if not yet selected. */
  public get activeCustomerId(): string | null {
    return this._activeCustomerId;
  }

  /** All known customers (for the UI dropdown / future sidebar). */
  public get customers(): AquaButlerCustomerConfig[] {
    return this._cfg.customers;
  }

  public get enabled(): boolean {
    return this._cfg.enabled;
  }

  /**
   * Switch the active customer. Idempotent; returns immediately if
   * the requested customer is already active. If a non-null target
   * isn't in the configured customer list, returns false; the UI
   * should treat that as a config error.
   */
  public async switchCustomer(
    nextId: string | null,
    reason: ActiveCustomerChangedEvent["reason"] = "user-switch",
  ): Promise<boolean> {
    if (this._closed) throw new Error("Fleet is shut down");
    if (nextId === this._activeCustomerId) return true;
    if (nextId !== null && !this._findCustomer(nextId)) return false;

    const previous = this._activeCustomerId;
    await this._teardownActive();

    if (nextId === null) {
      this._activeCustomerId = null;
      this.emit("active-changed", {
        previousCustomerId: previous,
        currentCustomerId: null,
        reason,
      } as ActiveCustomerChangedEvent);
      return true;
    }

    const customer = this._findCustomer(nextId)!;
    const opts: PerCustomerMqttClientOptions = {
      broker: this._cfg.broker,
      customer,
      factory: this._cfg.mcpClientFactory,
    };
    this._activeClient = new PerCustomerMqttClient(opts);
    if (!this._cfg.skipMqttForTests) {
      this._wireActiveClient(this._activeClient);
      this._activeClient.connect();
    }
    this._activeCustomerId = nextId;
    this.emit("active-changed", {
      previousCustomerId: previous,
      currentCustomerId: nextId,
      reason,
    } as ActiveCustomerChangedEvent);
    return true;
  }

  /**
   * Boot-time bring-up: read the config's `activeCustomerId` and start
   * the connection (if one is configured). Returns immediately;
   * consumers should subscribe to `connect` for connection readiness.
   */
  public async init(): Promise<void> {
    if (!this._cfg.enabled) {
      logger.info(
        "AquaButler multi-tenant mode disabled (POOL_AQUABUTLER_ENABLED=false or unset); fleet will idle.",
      );
      return;
    }
    if (this._cfg.customers.length === 0) {
      logger.warn(
        "AquaButler is enabled but no customers are configured; fleet will idle.",
      );
      return;
    }
    if (this._cfg.activeCustomerId) {
      await this.switchCustomer(this._cfg.activeCustomerId, "init");
    }
  }

  /**
   * Shutdown — close the active client (if any). Idempotent. Called
   * from Server.ts on SIGTERM / SIGINT.
   */
  public async shutdown(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._teardownActive();
  }

  /** Direct access to the per-customer client for the API layer. */
  public get activeClient(): PerCustomerMqttClient | null {
    return this._activeClient;
  }

  /* ---------- internal helpers ---------- */

  private _findCustomer(id: string): AquaButlerCustomerConfig | undefined {
    return this._cfg.customers.find((c) => c.id === id);
  }

  private _wireActiveClient(c: PerCustomerMqttClient): void {
    c.on("message", (evt: MqttMessageEvent) => {
      // Forward to fleet-level listeners (poolState store + UI).
      this.emit("message", evt);
    });
    c.on("error", (err) => {
      logger.error(`Active customer MQTT error: ${err.message}`);
      this.emit("error", err);
    });
    c.on("connect", () => {
      logger.info(
        `Active customer MQTT connected: ${this._activeCustomerId}`,
      );
      this.emit("connect");
    });
    c.on("close", () => {
      logger.info(
        `Active customer MQTT closed: ${this._activeCustomerId}`,
      );
      this.emit("close");
    });
  }

  private async _teardownActive(): Promise<void> {
    if (!this._activeClient) return;
    const c = this._activeClient;
    // Remove listeners first so the close event doesn't fan out a stale message.
    c.removeAllListeners();
    this._activeClient = null;
    try {
      await c.close();
    } catch (e) {
      logger.warn(`Error closing active customer MQTT: ${(e as Error).message}`);
    }
  }
}
