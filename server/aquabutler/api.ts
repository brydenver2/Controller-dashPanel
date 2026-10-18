/**
 * AquaButler REST routes + Socket.IO bridge.
 *
 * Endpoints:
 *   GET  /aquabutler/state           -> last-value snapshot for active customer
 *   GET  /aquabutler/customers       -> list of accessible customers (Layer 1 UI dropdown)
 *   POST /aquabutler/active-customer -> set the active customer (UI switch)
 *
 * Socket.IO bridge:
 *   Namespace: same as the rest of the dashPanel (no separate ns).
 *   Inbound events from the client: none at this layer — Layer 2 widgets
 *   will emit commands.
 *   Outbound events to the client:
 *     aquabutler:state  -> full snapshot when active customer changes
 *     aquabutler:change -> per-leaf update on every MQTT message
 *     aquabutler:connection -> online/offline state on client.connect/close
 *
 * Layer 1 doesn't expose command publish endpoints yet — those land
 * with Layer 2 widgets per the card body.
 */
import express from "express";
import { logger } from "./loggerSafe";
import { AquaButlerFleet } from "./fleet";
import { PoolStateStore } from "./poolState";
import { buildAuthMiddleware } from "./authMiddleware";
import {
  AquaButlerConfig,
  AquaButlerCustomerConfig,
} from "./customerConfig";

export interface AquaButlerApiDeps {
  fleet: AquaButlerFleet;
  state: PoolStateStore;
  cfg: AquaButlerConfig;
}

export class AquaButlerRoute {
  public static initRoutes(app: express.Application, deps: AquaButlerApiDeps) {
    const auth = buildAuthMiddleware(deps.cfg);

    const router = express.Router();
    router.use(auth);

    router.get("/customers", (_req, res) => {
      const customers: AquaButlerCustomerConfig[] = deps.fleet.customers;
      res.json({
        activeCustomerId: deps.fleet.activeCustomerId,
        customers: customers.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          permissionScope: c.permissionScope,
        })),
      });
    });

    router.post("/active-customer", async (req, res) => {
      const id = typeof req.body?.customerId === "string"
        ? req.body.customerId
        : null;
      if (id === null) {
        return res.status(400).json({ error: "missing customerId" });
      }
      const ok = await deps.fleet.switchCustomer(id, "user-switch");
      if (!ok) {
        return res.status(404).json({
          error: "unknown-customer",
          message: `Customer '${id}' is not configured.`,
        });
      }
      deps.state.setActiveCustomer(id);
      // Broadcast the new snapshot.
      res.json({
        activeCustomerId: deps.fleet.activeCustomerId,
        state: deps.state.current,
      });
    });

    router.get("/state", (_req, res) => {
      res.json({
        activeCustomerId: deps.fleet.activeCustomerId,
        state: deps.state.current,
      });
    });

    app.use("/aquabutler", router);
  }

  /**
   * Wire the fleet + state events onto the socket.io namespace. Called
   * once at server boot after both `initRoutes` and the active socket
   * server are available.
   */
  public static wireSocketBridge(
    socketServer: { emit: (evt: string, ...data: unknown[]) => void },
    deps: AquaButlerApiDeps,
  ): void {
    deps.fleet.on("active-changed", (evt: unknown) => {
      const e = evt as { currentCustomerId: string | null };
      if (e.currentCustomerId !== null) {
        deps.state.setActiveCustomer(e.currentCustomerId);
      }
      socketServer.emit("aquabutler:state", {
        activeCustomerId: deps.fleet.activeCustomerId,
        state: deps.state.current,
      });
    });

    deps.fleet.on("message", (evt: unknown) => {
      const e = evt as { topic: string; payload: Buffer };
      // Best-effort JSON parse — schema v1.0 payloads are JSON, but
      // some compiler-friendly endpoints are binary in future.
      let parsedPayload: unknown = e.payload;
      try {
        parsedPayload = JSON.parse(e.payload.toString("utf8"));
      } catch {
        // not JSON; leave raw — Layer 2 will treat as opaque bytes
      }
      const applied = deps.state.applyMessage(e.topic, parsedPayload);
      if (applied) {
        socketServer.emit("aquabutler:change", {
          topic: e.topic,
          payload: parsedPayload,
        });
      }
    });

    deps.fleet.on("connect", () =>
      socketServer.emit("aquabutler:connection", { state: "connected" }),
    );
    deps.fleet.on("close", () =>
      socketServer.emit("aquabutler:connection", { state: "disconnected" }),
    );
    deps.fleet.on("error", (err: unknown) => {
      logger.error(
        `AquaButler fleet error (broadcast to UI): ${(err as Error).message}`,
      );
    });
  }
}
