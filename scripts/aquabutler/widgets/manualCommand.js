/* AquaButler manual command widget (Layer 2, item 4).
 *
 * Publishes to /aquabutler/command/manual with a 30-second confirmation
 * window per the canonical safety UX. The chlorination override uses
 * the server-side interlock (chem/orp < 800 per schema v1.0 §Write
 * topics table); we disable the button on the client as a UX hint, but
 * the server is authoritative.
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §Write topics
 *   server/aquabutler/api.ts (POST /command/manual handler +
 *     checkChlorinationInterlock)
 */
(function ($) {
  "use strict";

  const CONFIRM_WINDOW_MS = 30_000;

  function unwrap(v) {
    if (v && typeof v === "object" && "value" in v) return v.value;
    return v;
  }

  function showMessage($host, text, kind) {
    const $msg = $host.find(".aqb-cmd-message");
    $msg.text(text || "").removeClass("aqb-msg-error aqb-msg-ok");
    if (text) {
      $msg.removeAttr("hidden");
      if (kind === "error") $msg.addClass("aqb-msg-error");
      else if (kind === "ok") $msg.addClass("aqb-msg-ok");
    } else {
      $msg.attr("hidden", "hidden");
    }
  }

  function bootstrap($host) {
    if (!window.AquaButlerBus) {
      $host.text("AquaButler bus not loaded.");
      return;
    }
    const bus = window.AquaButlerBus;
    bus.connect();

    const state = {
      pending: null, // { action, params }
      confirmTimer: null,
      orpValue: null,
    };

    function refreshChlorStatus() {
      const $status = $host.find(".aqb-cmd-chlor-status");
      const $btn = $host.find('.aqb-cmd[data-action="chlorination"]');
      if (state.orpValue === null || typeof state.orpValue !== "number") {
        $status.text("chem/orp: no data").removeClass("aqb-safe aqb-unsafe");
        $btn.prop("disabled", true);
        return;
      }
      const safe = state.orpValue < 800;
      $status
        .text(`chem/orp: ${state.orpValue} mV — ${safe ? "safe" : "LOCKED OUT"}`)
        .addClass(safe ? "aqb-safe" : "aqb-unsafe");
      $btn.prop("disabled", !safe);
    }

    function cancelPending() {
      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }
      state.pending = null;
      $host.find(".aqb-cmd-confirm-bar").attr("hidden", "hidden");
      $host.find(".aqb-cmd").removeClass("aqb-confirm-pending");
    }

    function startConfirm(action, params) {
      // Chlorination client-side gate: if telemetry is missing or
      // unsafe, refuse. The server will also refuse; this is purely
      // a UX hint so we don't even open the confirm window for an
      // action we know will fail.
      if (action === "chlorination") {
        if (state.orpValue === null || state.orpValue >= 800) {
          showMessage(
            $host,
            "Chlorination refused: chem/orp telemetry not safe.",
            "error",
          );
          return;
        }
      }
      state.pending = { action, params };
      $host.find(`.aqb-cmd[data-action="${action}"]`).addClass("aqb-confirm-pending");
      $host.find(".aqb-cmd-confirm-text").text(
        `Confirm ${action} (${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ")})`,
      );
      $host.find(".aqb-cmd-confirm-bar").removeAttr("hidden");
      showMessage($host, "Confirm within 30 seconds.", "ok");
      if (state.confirmTimer) clearTimeout(state.confirmTimer);
      state.confirmTimer = setTimeout(() => {
        cancelPending();
        showMessage($host, "Confirmation window expired.", "error");
      }, CONFIRM_WINDOW_MS);
    }

    function doConfirm() {
      if (!state.pending) return;
      const { action, params } = state.pending;
      bus
        .publishManualCommand(action, params)
        .then(() => {
          showMessage($host, `${action} published.`, "ok");
          cancelPending();
        })
        .catch((err) => {
          const reason = err.body?.reason || err.body?.error || err.message;
          showMessage($host, `${action} failed: ${reason}`, "error");
          cancelPending();
        });
    }

    // Event wiring
    $host.on("click", ".aqb-cmd", function () {
      const action = $(this).data("action");
      let params = {};
      if (action === "pump") {
        params = {
          state: $(this).data("state"),
          duration_min: 60,
        };
      } else if (action === "filter") {
        const hours = Math.max(
          1,
          Math.min(12, parseInt($host.find(".aqb-cmd-filter-hours").val(), 10) || 4),
        );
        params = { duration_hr: hours };
      } else if (action === "chlorination") {
        const target = parseInt($host.find(".aqb-cmd-chlor-target").val(), 10) || 700;
        const min = Math.max(
          1,
          Math.min(10, parseInt($host.find(".aqb-cmd-chlor-min").val(), 10) || 5),
        );
        params = { target_orp_mV: target, duration_min: min, max_duration_min: 10 };
      } else if (action === "heater") {
        const target = Math.max(
          60,
          Math.min(104, parseInt($host.find(".aqb-cmd-heater-target").val(), 10) || 82),
        );
        params = { target_f: target };
      }
      startConfirm(action, params);
    });

    $host.on("click", ".aqb-cmd-confirm", doConfirm);
    $host.on("click", ".aqb-cmd-cancel", () => {
      cancelPending();
      showMessage($host, "");
    });

    // Live updates: track chem/orp for the chlorination gate.
    bus.onChange((evt) => {
      const m = (evt.topic || "").match(/^pool\/[^/]+\/chem\/orp$/);
      if (!m) return;
      state.orpValue = unwrap(evt.payload);
      refreshChlorStatus();
    });

    // Initial paint: pull snapshot for the chlorination gate.
    bus
      .getState()
      .then((snap) => {
        const chem = snap?.state?.chem || {};
        state.orpValue = unwrap(chem.orp);
        refreshChlorStatus();
      })
      .catch(() => {});
  }

  $(function () {
    const $host = $("#aquabutler-manual-command-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);