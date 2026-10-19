/* AquaButler per-customer live state widget (Layer 2, item 1).
 *
 * Subscribes to the existing socket.io bus (`aquabutler:change` events)
 * and updates the per-leaf cells in the host. The cell-fade and
 * offline-detection logic lives here; the page only provides the host
 * `<div id="aquabutler-live-state-host">` fragment from
 * `liveState.html`.
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §Read topics
 *   server/aquabutler/api.ts (the server-side bridge this widget reads)
 *   scripts/aquabutler/mqttBus.js (the shared socket wrapper)
 *
 * Theme: bare-bones; Layer 3 (theming) owns the visual pass.
 */
(function ($) {
  "use strict";

  /**
   * Render a leaf value to its display string. Schema v1.0 reads
   * payloads as `{value, last_changed}` envelopes — after the
   * server-side `poolState.applyMessage` unwrap, the cell sees the
   * raw scalar. But the socket bridge re-emits the unwrapped JSON
   * `{topic, payload}` where `payload` is the inner scalar (because
   * the bridge does `socketServer.emit("aquabutler:change", {topic,
   * payload: parsedPayload})` — `parsedPayload` is whatever the
   * publisher sent, which for envelope topics is `{value, ...}`).
   *
   * So we need to unwrap here too. (A future refactor could push the
   * unwrap into the bridge itself, but today the bridge is the same
   * code that handles binary/non-JSON payloads — leaving the unwrap
   * in poolState was the cleanest split.)
   */
  function unwrap(v) {
    if (v && typeof v === "object" && "value" in v) return v.value;
    return v;
  }

  function fmt(leaf, v) {
    if (v === undefined || v === null) return "—";
    switch (leaf) {
      case "telemetry/ph":
        return Number(v).toFixed(1);
      case "telemetry/orp_mV":
        return `${Math.round(Number(v))} mV`;
      case "telemetry/pump_rpm":
        return `${Math.round(Number(v))} rpm`;
      case "telemetry/temp_pool":
      case "telemetry/temp_air":
      case "telemetry/heater_setpoint_f":
        return `${Number(v).toFixed(1)} °F`;
      default:
        return String(v);
    }
  }

  function bootstrap($host) {
    if (!window.AquaButlerBus) {
      $host.text("AquaButler bus not loaded.");
      return;
    }
    const bus = window.AquaButlerBus;
    bus.connect();

    const cells = {};
    $host.find("td[data-leaf]").each(function () {
      const leaf = $(this).data("leaf");
      cells[leaf] = $(this);
    });

    let lastSeen = 0; // ms timestamp of the most recent message
    const OFFLINE_MS = 120_000;

    function checkOffline() {
      const banner = $host.find(".aqb-offline-banner");
      if (lastSeen === 0) {
        banner.attr("hidden", "hidden");
        return;
      }
      const sinceMs = Date.now() - lastSeen;
      if (sinceMs > OFFLINE_MS) {
        banner.removeAttr("hidden");
      } else {
        banner.attr("hidden", "hidden");
      }
    }

    setInterval(checkOffline, 5000);

    // Track the most recent mqtt_connected leaf separately so the
    // comm cell renders a real "online/offline" pulse. Schema v1.0
    // §health/<check> is a FLAT per-metric tree (not the aggregated
    // `health/system`/`health/comm` from the kanban card body) —
    // see docs/wiki/2026-10-18-dashpanel-aquabutler-layer2.md.
    let mqttConnected = null;

    bus.onChange((evt) => {
      lastSeen = Date.now();
      checkOffline();
      // Topic shape: pool/<id>/<group>/<leaf>
      const topic = evt.topic || "";
      const m = topic.match(/^pool\/[^/]+\/([^/]+)\/([^/]+)$/);
      if (!m) return;
      const leaf = `${m[1]}/${m[2]}`;
      if (leaf === "health/mqtt_connected") {
        mqttConnected = unwrap(evt.payload) === true;
        const cell = cells["health/mqtt_connected"];
        if (cell) {
          cell.text(mqttConnected ? "online" : "offline");
          cell.toggleClass("aqb-cell-bad", !mqttConnected);
        }
        return;
      }
      const cell = cells[leaf];
      if (!cell) return;
      const v = unwrap(evt.payload);
      const display = fmt(leaf, v);
      cell.text(display);
      // 2s fade — add the class; the CSS transition fades it out on remove.
      cell.addClass("aqb-cell-updated");
      setTimeout(() => cell.removeClass("aqb-cell-updated"), 50);
    });

    // Initial paint: pull snapshot once so the widget isn't blank on load.
    bus
      .getState()
      .then((snap) => {
        const state = (snap && snap.state) || {};
        for (const group of Object.keys(state)) {
          for (const leaf of Object.keys(state[group] || {})) {
            const key = `${group}/${leaf}`;
            const cell = cells[key];
            if (!cell) continue;
            const v = unwrap(state[group][leaf]);
            if (key === "health/mqtt_connected") {
              const connected = v === true;
              cell.text(connected ? "online" : "offline");
              cell.toggleClass("aqb-cell-bad", !connected);
              continue;
            }
            cell.text(fmt(key, v));
          }
        }
      })
      .catch(() => {
        // 401 or auth-not-wired is fine — the bus will surface state
        // once auth lands. Don't blank the widget.
      });
  }

  $(function () {
    const $host = $("#aquabutler-live-state-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);