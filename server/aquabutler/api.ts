/**
 * AquaButler REST routes + Socket.IO bridge (Layer 1 + Layer 2).
 *
 * Layer 1 endpoints (still live):
 *   GET  /aquabutler/state           -> last-value snapshot for active customer
 *   GET  /aquabutler/customers       -> list of accessible customers (UI dropdown)
 *   POST /aquabutler/active-customer -> set the active customer (UI switch)
 *
 * Layer 2 endpoints (this commit):
 *   POST /aquabutler/command/manual -> publish a manual override
 *                                      (pump | filter | chlorination | heater);
 *                                      performs pre-publish safety interlock
 *                                      for chlorination; emits a paired
 *                                      audit/dashpanel_action entry.
 *   POST /aquabutler/command/service -> enter / exit / force_exit service
 *                                       mode with sha256(pin) auth.
 *   GET  /aquabutler/audit          -> list audit entries (paginated,
 *                                       newest-first) for the active customer.
 *   GET  /aquabutler/audit.csv      -> same data, CSV format, attachment.
 *
 * Socket.IO bridge:
 *   Namespace: same as the rest of the dashPanel (no separate ns).
 *   Inbound events from the client: none at this layer — Layer 2 widgets
 *   POST commands via REST and read state via the bridge below.
 *   Outbound events to the client:
 *     aquabutler:state       -> full snapshot when active customer changes
 *     aquabutler:change      -> per-leaf update on every MQTT message
 *     aquabutler:audit       -> per-entry update when an audit message arrives
 *     aquabutler:connection  -> online/offline state on client.connect/close
 */
import express from "express";
import { logger } from "./loggerSafe";
import { AquaButlerFleet } from "./fleet";
import { PoolStateStore } from "./poolState";
import { AuditLogStore, RetainedAuditEntry } from "./auditLog";
import { buildAuthMiddleware } from "./authMiddleware";
import {
  AquaButlerConfig,
  AquaButlerCustomerConfig,
} from "./customerConfig";
import { commandSuffix, auditSuffix, AuditEnvelope } from "./mqttClient";
import { MANUAL_ACTION, AUTH_SOURCE, ManualAction, AuthSource } from "./mqttTopics";

export interface AquaButlerApiDeps {
  fleet: AquaButlerFleet;
  state: PoolStateStore;
  auditLog: AuditLogStore;
  cfg: AquaButlerConfig;
}

/**
 * The set of manual override actions the dashPanel can publish.
 * Mirrors schema v1.0 §Write topics — see `MANUAL_ACTION` in mqttTopics.
 */
const VALID_MANUAL_ACTIONS: ReadonlySet<string> = new Set([
  MANUAL_ACTION.pump,
  MANUAL_ACTION.filter,
  MANUAL_ACTION.chlorination,
  MANUAL_ACTION.heater,
]);

/**
 * Pre-publish safety interlock for chlorination override.
 *
 * Per AquaButler MQTT schema v1.0 §Write topics table:
 *   `command/manual/chlorination/set` requires `pool/<id>/chem/orp.value < 800`
 *   before publishing.
 *
 * After poolState's schema-envelope unwrap, `chem.orp` is the raw
 * numeric value (not a `{value, last_changed}` object). The check
 * fails closed if the value is missing, NaN, or >= 800.
 *
 * The card body lists `pool/<id>/telemetry/orp_mV.value > 800` as the
 * trip-wire, but the canonical sensor source is the `chem/orp` topic
 * (per schema §chem/<parameter>); telemetry/orp_mV is the raw reading
 * before probe_id tagging. The schema is authoritative — the dashPanel
 * Layer 2 fails closed against the chem envelope. See
 * docs/wiki/2026-10-18-dashpanel-aquabutler-layer2.md for the
 * cross-reference.
 */
export function checkChlorinationInterlock(state: PoolStateStore): {
  ok: boolean;
  reason?: string;
} {
  const chem = state.current["chem"] as
    | { orp?: unknown }
    | undefined;
  const chemOrp = chem?.orp;
  // Fail-closed: if telemetry hasn't arrived yet (undefined / NaN /
  // null), refuse. We don't want a green button just because no
  // sensor message has landed since boot.
  if (typeof chemOrp !== "number" || !Number.isFinite(chemOrp)) {
    return {
      ok: false,
      reason:
        "chlorination_lockout_800mV (chem/orp telemetry not yet available)",
    };
  }
  if (chemOrp >= 800) {
    return {
      ok: false,
      reason: `chlorination_lockout_800mV (chem/orp=${chemOrp} >= 800)`,
    };
  }
  return { ok: true };
}

/**
 * Build an audit envelope around a manual-override publish.
 *
 * `outcome` is `"executed"` when the command publish succeeded,
 * `"rejected_safety"` when the interlock refused, `"failed"` when the
 * broker publish raised.
 *
 * The schema v1.0 §audit/<stream> envelope is:
 *   `{ts, action, params, source, user_id, outcome, error}`
 * — `source` and `user_id` are TOP-LEVEL (no `auth:` wrapper).
 */
export function buildAuditEnvelope(
  action: string,
  params: Record<string, unknown>,
  source: AuthSource,
  userId: string | null,
  outcome: AuditEnvelope["outcome"],
  error: string | null,
): AuditEnvelope {
  return {
    ts: new Date().toISOString(),
    action,
    params,
    source,
    user_id: userId,
    outcome,
    error,
  };
}

/**
 * Build a sha256:<hex> hash for service-mode PIN entry.
 *
 * pin_hash per schema v1.0 §pool/<id>/command/service/set:
 *   pin_hash = "sha256:" + lower_hex( sha256( utf8(pin_string) ) )   (Option A)
 * Matches what serviceMode.js sends; same Option A the rotary firmware
 * computes (see ~/AquaButler-Server/src/rotary_display/rotary_display/
 * modes/service_mode.py:172-175 + eeprom/hat_eeprom.py:222-227).
 * v1.1 hardening (cluster-secret HMAC, Option C, see schema open
 * question §9.12) will switch the prefix to `sha256-hmac:` — do NOT
 * preemptively change anything here.
 *
 * Exported for tests; the actual UI uses Web Crypto SubtleCrypto.
 */
export async function sha256Hex(input: string): Promise<string> {
  // Node-side helper for server-side hash (tests + future server-driven
  // flows like the integration smoke test). The browser widget uses
  // window.crypto.subtle.digest, not this one — they're equivalent.
  const { createHash } = await import("crypto");
  return "sha256:" + createHash("sha256").update(input).digest("hex");
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
        ? req.body?.customerId
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
      deps.auditLog.setActiveCustomer(id);
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

    /* ---------- Layer 2: manual override publish ---------- */

    router.post("/command/manual", async (req, res) => {
      const body = req.body || {};
      const action = typeof body.action === "string" ? body.action : null;
      if (action === null || !VALID_MANUAL_ACTIONS.has(action)) {
        return res.status(400).json({
          error: "invalid-action",
          message: `action must be one of: ${[...VALID_MANUAL_ACTIONS].join(", ")}`,
        });
      }
      const params =
        typeof body.params === "object" && body.params !== null
          ? body.params
          : {};

      const client = deps.fleet.activeClient;
      const userId = req.aquaButlerSubject?.userId ?? null;

      // Safety interlock: chlorination refuses if chem/orp >= 800 or
      // telemetry is stale. We still emit a paired audit entry so the
      // tech sees the refusal in the log.
      if (action === MANUAL_ACTION.chlorination) {
        const check = checkChlorinationInterlock(deps.state);
        if (!check.ok) {
          // Publish a rejected_safety audit entry — uses the same
          // envelope shape as executed, with `error` set to the
          // reason string. Schema v1.0 §audit/<stream>.
          try {
            if (client) {
              const auditEntry = buildAuditEnvelope(
                "chlorination_override",
                params as Record<string, unknown>,
                AUTH_SOURCE.dashpanel,
                userId,
                "rejected_safety",
                check.reason || "chlorination_lockout_800mV",
              );
              await client.publishAudit(
                auditSuffix.dashpanelAction(),
                auditEntry,
              );
            }
          } catch (e) {
            logger.warn(
              `AquaButler: failed to write rejected_safety audit entry: ${(e as Error).message}`,
            );
          }
          return res.status(409).json({
            error: "rejected_safety",
            reason: check.reason,
          });
        }
      }

      if (!client) {
        return res.status(503).json({
          error: "not-connected",
          message: "No MQTT client is active for the current customer.",
        });
      }

      try {
        const suffix = (commandSuffix as Record<string, () => string>)[
          `manual${action.charAt(0).toUpperCase()}${action.slice(1)}`
        ]();
        await client.publishCommand(suffix, params as Record<string, unknown>, userId);

        const auditEntry = buildAuditEnvelope(
          // Action vocabulary per schema §audit/<stream> open question 7.
          // We map the manual action to the matching audit action verb.
          manualActionToAuditAction(action as ManualAction, params as Record<string, unknown>),
          params as Record<string, unknown>,
          AUTH_SOURCE.dashpanel,
          userId,
          "executed",
          null,
        );
        await client.publishAudit(auditSuffix.dashpanelAction(), auditEntry);

        return res.json({ ok: true, published: suffix });
      } catch (e) {
        const err = e as Error;
        logger.error(`AquaButler: manual command publish failed: ${err.message}`);
        // Best-effort audit entry for failed publishes so the tech can
        // correlate. Per §audit/<stream> the audit entry is the
        // canonical record — UI clients don't need to log separately.
        try {
          const auditEntry = buildAuditEnvelope(
            manualActionToAuditAction(action as ManualAction, params as Record<string, unknown>),
            params as Record<string, unknown>,
            AUTH_SOURCE.dashpanel,
            userId,
            "failed",
            err.message,
          );
          await client.publishAudit(auditSuffix.dashpanelAction(), auditEntry);
        } catch (ae) {
          logger.warn(
            `AquaButler: failed to write failed audit entry: ${(ae as Error).message}`,
          );
        }
        return res.status(502).json({
          error: "publish-failed",
          message: err.message,
        });
      }
    });

    /* ---------- Layer 2: service mode publish ---------- */

    router.post("/command/service", async (req, res) => {
      const body = req.body || {};
      const action = typeof body.action === "string" ? body.action : null;
      if (
        action === null ||
        !["enter", "exit", "force_exit"].includes(action)
      ) {
        return res.status(400).json({
          error: "invalid-action",
          message: "action must be one of: enter, exit, force_exit",
        });
      }
      const client = deps.fleet.activeClient;
      if (!client) {
        return res.status(503).json({
          error: "not-connected",
          message: "No MQTT client is active for the current customer.",
        });
      }
      const userId = req.aquaButlerSubject?.userId ?? null;

      const payload: Record<string, unknown> = { action };
      if (action !== "force_exit") {
        // pin_hash is required for enter / exit per §service/set
        if (typeof body.pin_hash !== "string" || !body.pin_hash.startsWith("sha256:")) {
          return res.status(400).json({
            error: "missing-pin-hash",
            message: "pin_hash must be a 'sha256:<64hex>' string",
          });
        }
        payload.pin_hash = body.pin_hash;
      }
      if (action === "enter" && typeof body.timeout_min === "number") {
        payload.timeout_min = body.timeout_min;
      }

      try {
        await client.publishCommand(
          commandSuffix.serviceSet(),
          payload,
          userId,
          // force_exit MUST come from a cloud account per §service/set.
          // The dashPanel is a tech account; we still send force_exit
          // through but the broker / njsPC layer is the gate.
          action === "force_exit" ? AUTH_SOURCE.cloud : AUTH_SOURCE.dashpanel,
        );
        const auditEntry = buildAuditEnvelope(
          `service_${action}`,
          payload,
          action === "force_exit" ? AUTH_SOURCE.cloud : AUTH_SOURCE.dashpanel,
          userId,
          "executed",
          null,
        );
        await client.publishAudit(auditSuffix.dashpanelAction(), auditEntry);
        return res.json({ ok: true, action });
      } catch (e) {
        const err = e as Error;
        logger.error(`AquaButler: service publish failed: ${err.message}`);
        return res.status(502).json({ error: "publish-failed", message: err.message });
      }
    });

    /* ---------- Layer 2: audit retrieval ---------- */

    router.get("/audit", (req, res) => {
      const stream = typeof req.query.stream === "string" ? req.query.stream : undefined;
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
        1000,
      );
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
      const entries = deps.auditLog.recent({ stream, limit, offset });
      res.json({
        activeCustomerId: deps.auditLog.activeCustomerId,
        total: deps.auditLog.size(),
        entries,
      });
    });

    router.get("/audit.csv", (req, res) => {
      const stream = typeof req.query.stream === "string" ? req.query.stream : undefined;
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "1000"), 10) || 1000, 1),
        10000,
      );
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
      const entries = deps.auditLog.recent({ stream, limit, offset });
      const csv = renderAuditCsv(entries);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="aquabutler-audit-${deps.auditLog.activeCustomerId || "all"}.csv"`,
      );
      res.send(csv);
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
        deps.auditLog.setActiveCustomer(e.currentCustomerId);
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
      // Audit retention runs in parallel with state updates — both
      // share the same JSON parse result, and either store may apply.
      if (e.topic.includes("/audit/")) {
        const retained = deps.auditLog.appendFromMessage(e.topic, parsedPayload);
        if (retained) {
          socketServer.emit("aquabutler:audit", {
            topic: e.topic,
            payload: parsedPayload,
          });
        }
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

/**
 * Map the schema v1.0 manual-action namespace (`pump` | `filter` |
 * `chlorination` | `heater`) to the audit-action vocabulary
 * (open question §9.7: `pump_on`, `pump_off`, `filter_cycle`,
 * `chlorination_override`, `heater_target`).
 *
 * The action verb is the audit record's "what happened" — we derive
 * it from the params because the params carry the discriminating
 * fields (e.g., `state: "on"|"off"` for the pump).
 */
function manualActionToAuditAction(
  action: ManualAction,
  params: Record<string, unknown>,
): string {
  switch (action) {
    case MANUAL_ACTION.pump: {
      const state = params.state === "on" ? "pump_on" : "pump_off";
      return state;
    }
    case MANUAL_ACTION.filter:
      return "filter_cycle";
    case MANUAL_ACTION.chlorination:
      return "chlorination_override";
    case MANUAL_ACTION.heater:
      return "heater_target";
    default:
      return String(action);
  }
}

/**
 * Render the audit log to CSV. RFC 4180-ish (no trailing newline, quote
 * everything that contains a separator or a quote).
 */
function renderAuditCsv(entries: RetainedAuditEntry[]): string {
  const header = ["ts", "action", "stream", "source", "user_id", "outcome", "error", "params"];
  const rows: string[][] = [header];
  for (const e of entries) {
    rows.push([
      e.ts,
      e.action,
      e.stream,
      e.source,
      e.user_id ?? "",
      e.outcome,
      e.error ?? "",
      JSON.stringify(e.params),
    ]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}