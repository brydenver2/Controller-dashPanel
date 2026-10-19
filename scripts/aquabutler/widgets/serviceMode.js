/* AquaButler service mode widget (Layer 2, item 3).
 *
 * Enter / Exit / Force-exit with a 30-second confirmation window.
 * PIN entry uses Web Crypto SubtleCrypto (sha256(pin) → "sha256:<64hex>")
 * and sends the hash to the server, which forwards to
 * `pool/<id>/command/service/set`.
 *
 * pin_hash per schema v1.0 §pool/<id>/command/service/set:
 *   pin_hash = "sha256:" + lower_hex( sha256( utf8(pin_string) ) )   (Option A)
 * This widget computes Option A and ships `sha256:<64hex>` to the
 * server. v1.1 hardening (cluster-secret HMAC, Option C, see schema
 * open question §9.12) will switch the prefix to `sha256-hmac:` and
 * add per-deploy provisioning — do NOT preemptively change anything.
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §service/set
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §service/state
 *   server/aquabutler/api.ts (POST /command/service handler)
 */
(function ($) {
  "use strict";

  const CONFIRM_WINDOW_MS = 30_000;
  const VALID_PIN = /^[0-9]{4}$/;

  function unwrap(v) {
    if (v && typeof v === "object" && "value" in v) return v.value;
    return v;
  }

  function fmtCountdown(expiresAt) {
    const ms = new Date(expiresAt).valueOf() - Date.now();
    if (Number.isNaN(ms)) return "—";
    if (ms <= 0) return "expired";
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s.toString().padStart(2, "0")}s remaining`;
  }

  function showMessage($host, text, kind) {
    const $msg = $host.find(".aqb-service-message");
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
      mode: "normal",
      pendingAction: null, // "enter" | "exit" | "force_exit" | null
      confirmDeadline: 0,
      confirmTimer: null,
    };

    function applyMode(mode, expiresAt) {
      state.mode = mode;
      const $modeVal = $host.find(".aqb-service-mode-value")
        .text(mode)
        .removeClass("aqb-mode-service aqb-mode-timeout");
      if (mode === "service") $modeVal.addClass("aqb-mode-service");
      else if (mode === "timeout") $modeVal.addClass("aqb-mode-timeout");

      const $cd = $host.find(".aqb-service-countdown");
      if (mode === "service" && expiresAt) {
        $cd.text(fmtCountdown(expiresAt)).removeAttr("hidden");
      } else {
        $cd.attr("hidden", "hidden").text("");
      }

      $host.find(".aqb-service-enter").attr("hidden", mode === "service" ? "hidden" : null);
      $host.find(".aqb-service-exit").attr("hidden", mode === "service" ? null : "hidden");
      $host.find(".aqb-service-force-exit").attr("hidden", mode === "service" ? null : "hidden");
    }

    function cancelPending() {
      if (state.confirmTimer) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = null;
      }
      state.pendingAction = null;
      $host.find(".aqb-service-pin-row").attr("hidden", "hidden");
      $host.find(".aqb-service-confirm")
        .prop("disabled", true)
        .removeClass("aqb-confirm-pending")
        .text("Confirm");
      $host.find(".aqb-service-actions button").removeClass("aqb-confirm-pending");
    }

    function startConfirm(action) {
      // Force-exit does not require PIN.
      const needsPin = action === "enter" || action === "exit";
      state.pendingAction = action;
      state.confirmDeadline = Date.now() + CONFIRM_WINDOW_MS;

      $host.find(`.aqb-service-actions button[data-action="${action}"]`)
        .addClass("aqb-confirm-pending");

      if (needsPin) {
        $host.find(".aqb-service-pin-row").removeAttr("hidden");
        $host.find(".aqb-service-pin").val("").focus();
      } else {
        // No PIN row needed; flip to the inline confirm path.
        $host.find(".aqb-service-confirm")
          .prop("disabled", false)
          .addClass("aqb-confirm-pending")
          .text("Confirm force exit");
        $host.find(".aqb-service-pin-row").attr("hidden", "hidden");
      }

      showMessage($host, "Confirm within 30 seconds.", "ok");

      if (state.confirmTimer) clearTimeout(state.confirmTimer);
      state.confirmTimer = setTimeout(() => {
        cancelPending();
        showMessage($host, "Confirmation window expired.", "error");
      }, CONFIRM_WINDOW_MS);
    }

    function doConfirm() {
      const action = state.pendingAction;
      if (!action) return;
      const needsPin = action === "enter" || action === "exit";
      let payload = {};
      const doPublish = () => {
        bus
          .publishServiceCommand(action, payload)
          .then(() => {
            showMessage($host, `${action} sent.`, "ok");
            cancelPending();
          })
          .catch((err) => {
            showMessage(
              $host,
              `${action} failed: ${err.body?.message || err.message}`,
              "error",
            );
            cancelPending();
          });
      };

      if (needsPin) {
        const pin = $host.find(".aqb-service-pin").val();
        if (!VALID_PIN.test(pin)) {
          showMessage($host, "PIN must be 4 digits.", "error");
          return;
        }
        bus
          .sha256Hex(pin)
          .then((pin_hash) => {
            payload = { pin_hash };
            doPublish();
          })
          .catch((err) => {
            showMessage($host, `Hash failed: ${err.message}`, "error");
          });
      } else {
        doPublish();
      }
    }

    // Event wiring
    $host.on("click", ".aqb-service-enter", () => startConfirm("enter"));
    $host.on("click", ".aqb-service-exit", () => startConfirm("exit"));
    $host.on("click", ".aqb-service-force-exit", () => startConfirm("force_exit"));
    $host.on("click", ".aqb-service-confirm", doConfirm);
    $host.on("click", ".aqb-service-cancel", () => {
      cancelPending();
      showMessage($host, "");
    });
    $host.on("input", ".aqb-service-pin", function () {
      const pin = $(this).val();
      $host.find(".aqb-service-confirm").prop("disabled", !VALID_PIN.test(pin));
    });

    // Subscribe to live service/state updates.
    bus.onChange((evt) => {
      const m = (evt.topic || "").match(/^pool\/[^/]+\/service\/state$/);
      if (!m) return;
      const p = evt.payload || {};
      // The envelope may wrap a {mode, ...} object directly.
      applyMode(unwrap(p.mode) || "normal", p.expires_at || null);
    });

    // Initial paint
    bus
      .getState()
      .then((snap) => {
        const svc = snap?.state?.service?.state;
        if (svc) {
          applyMode(unwrap(svc.mode) || "normal", svc.expires_at || null);
        }
      })
      .catch(() => {});
  }

  $(function () {
    const $host = $("#aquabutler-service-mode-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);