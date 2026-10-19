/* AquaButler client-side audit envelope builder.
 *
 * Single source of truth for the schema v1.0 §audit/<stream> envelope
 * shape on the *write* side. Used by every Layer 2 widget that
 * publishes a user action.
 *
 * Important: audit messages go to `pool/<id>/audit/<stream>` and use
 * TOP-LEVEL `source` and `user_id` fields (NOT the `auth:` envelope
 * that command messages use). See
 * ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §audit/<stream>.
 *
 * Note: the dashPanel doesn't build these envelopes directly — the
 * server-side REST handler `buildAuditEnvelope()` does, and the
 * widgets POST to /aquabutler/command/manual which writes the paired
 * audit entry. This client-side module is here so the *UI* can
 * pre-render an audit row before the server confirms (so the tech
 * sees their action immediately rather than after the broker ACK),
 * and so the audit log widget's CSV export matches the on-the-wire
 * schema exactly.
 *
 * For write-side widgets that need to know the canonical action verb
 * mapping (pump → pump_on/pump_off; filter → filter_cycle; etc.) see
 * `manualActionToAuditAction` below — mirrors server/aquabutler/api.ts.
 */
(function () {
  "use strict";

  const VALID_ACTIONS = new Set([
    "pump_on", "pump_off",
    "filter_cycle",
    "chlorination_override",
    "heater_target",
    "service_enter", "service_exit", "service_force_exit",
    "auto_exit",
  ]);

  /**
   * Map a manual command's action verb to the corresponding audit
   * entry action. Mirrors server/aquabutler/api.ts.
   */
  function manualActionToAuditAction(action, params) {
    switch (action) {
      case "pump":
        return params && params.state === "on" ? "pump_on" : "pump_off";
      case "filter":
        return "filter_cycle";
      case "chlorination":
        return "chlorination_override";
      case "heater":
        return "heater_target";
      default:
        return String(action);
    }
  }

  /**
   * Build a UI-side preview of the audit entry that a publish will
   * generate. Returns the schema v1.0 envelope shape — same field
   * names and types the server uses. The server is the canonical
   * emitter; this preview is purely cosmetic (helps the tech see the
   * action in the audit log immediately, before the broker ACK).
   */
  function previewAuditEntry(action, params, source, userId, outcome, error) {
    return {
      ts: new Date().toISOString(),
      action,
      params: params || {},
      source: source || "dashpanel",
      user_id: userId || null,
      outcome: outcome || "executed",
      error: error || null,
      stream: "dashpanel_action",
    };
  }

  window.AquaButlerAudit = {
    VALID_ACTIONS,
    manualActionToAuditAction,
    previewAuditEntry,
  };
})();