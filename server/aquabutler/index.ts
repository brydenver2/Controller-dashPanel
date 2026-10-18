/**
 * AquaButler public init entrypoint.
 *
 * Called from app.ts once per process boot. Wires the REST router
 * onto every running express app and bridges the fleet's events into
 * the existing Socket.IO instance. The `enabled` check is on the
 * config — if disabled, this is a no-op (preserves the upstream
 * hobbyist single-tenant use case).
 *
 * Init order:
 *   app.ts -> config.init() -> webApp.init() (spawns http/https) ->
 *   -> initAquaButlerOnServer(webApp) -> the express apps already exist.
 *
 * If `initAquaButlerOnServer` is called BEFORE `webApp.init()` (e.g.,
 * some future hot-reload scenario), it gracefully degrades: no apps
 * means no routes, no sock server means no bridge. The next call
 * resolves them via the live `webApp` getters.
 */
import express from "express";
import { logger } from "./loggerSafe";
import { loadAquaButlerConfig } from "./customerConfig";
import { AquaButlerFleet } from "./fleet";
import { PoolStateStore } from "./poolState";
import { AquaButlerRoute } from "./api";

export interface AquaButlerServerLike {
  expressApps: express.Application[];
  sockServer: { emit: (evt: string, ...data: unknown[]) => void } | null;
}

let fleet: AquaButlerFleet | null = null;
let store: PoolStateStore | null = null;

export async function initAquaButlerOnServer(
  server: AquaButlerServerLike,
): Promise<AquaButlerFleet | null> {
  const cfg = loadAquaButlerConfig();
  if (!cfg.enabled) {
    logger.info(
      "AquaButler disabled by config; not initializing fleet (preserves upstream use case).",
    );
    return null;
  }

  fleet = new AquaButlerFleet(cfg);
  store = new PoolStateStore();

  const apps = server.expressApps;
  if (apps.length === 0) {
    logger.warn(
      "AquaButler init: no express apps are running yet — routes will not be mounted. Re-init later if needed.",
    );
  } else {
    for (const app of apps) {
      AquaButlerRoute.initRoutes(app, { fleet, state: store, cfg });
    }
  }

  await fleet.init();
  if (cfg.activeCustomerId) {
    store.setActiveCustomer(cfg.activeCustomerId);
  }

  // Bridge fleet events to socket.io, if the socket server is ready.
  const sock = server.sockServer;
  if (sock) {
    AquaButlerRoute.wireSocketBridge(sock, { fleet, state: store, cfg });
  } else {
    logger.warn(
      "AquaButler init: no socket server is running yet — bridge will not forward events. Layer 2 widgets may need a reconnect to receive state after the socket server boots.",
    );
  }

  return fleet;
}

export async function shutdownAquaButler(): Promise<void> {
  if (!fleet) return;
  await fleet.shutdown();
  fleet = null;
  store = null;
}

/** Accessor for tests that need to drive the fleet directly. */
export function _getFleetForTests(): AquaButlerFleet | null {
  return fleet;
}
export function _getStoreForTests(): PoolStateStore | null {
  return store;
}
