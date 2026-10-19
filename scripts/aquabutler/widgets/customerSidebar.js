/* AquaButler customer switcher sidebar (Layer 2, item 5).
 *
 * Renders the customer list (from /aquabutler/customers) with an
 * at-a-glance status dot per customer. The active customer has the
 * top-bar switcher (Layer 1, customerSwitcher.js) reflect the current
 * selection — clicking a sidebar row delegates to that widget via
 * `setActiveCustomer` on the bus.
 *
 * Health status: per AquaButler MQTT schema v1.0 §health/<check>,
 * the dashPanel sees the FLAT tree (`health/cpu_temp_c`,
 * `health/mqtt_connected`, ...) — not the `health/system` aggregate
 * the card body references. So we treat the absence of any health
 * message for >120s as "stale" (yellow) and an explicit
 * `mqtt_connected: false` (or missing) as "red". A fresh message of
 * any kind within 120s is "green".
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §health/<check>
 *   scripts/aquabutler/customerSwitcher.js (Layer 1 top-bar dropdown
 *     — this widget updates its selection in lockstep)
 */
(function ($) {
  "use strict";

  const STALE_MS = 120_000;

  function unwrap(v) {
    if (v && typeof v === "object" && "value" in v) return v.value;
    return v;
  }

  /**
   * Derive the status for a customer given (a) its most-recent health
   * message timestamp and (b) whether the mqtt_connected leaf is true.
   */
  function deriveStatus(lastSeenMs, mqttConnected) {
    if (mqttConnected === false) return "red";
    if (lastSeenMs === 0) return "unknown";
    if (Date.now() - lastSeenMs > STALE_MS) return "yellow";
    return "green";
  }

  function bootstrap($host) {
    if (!window.AquaButlerBus) {
      $host.text("AquaButler bus not loaded.");
      return;
    }
    const bus = window.AquaButlerBus;
    bus.connect();

    /**
     * Per-customer rolling last-seen and known health flags. The
     * current active customer's data lands here via the bus; other
     * customers' data won't (the dashPanel only subscribes to the
     * active customer's `pool/<id>/#`). Until Layer 2+ lands a
     * fleet-monitoring account (per the Layer 1 comment in
     * fleet.ts), we mark non-active customers "unknown" — the user
     * can hover for the tooltip explaining why.
     */
    const customerState = {}; // id -> {lastSeenMs, mqttConnected}

    function statusOf(id) {
      const s = customerState[id];
      if (!s) return "unknown";
      return deriveStatus(s.lastSeenMs, s.mqttConnected);
    }

    function renderSidebar(customers, activeId) {
      const $list = $host.find(".aqb-sidebar-list").empty();
      for (const c of customers) {
        const $li = $("<li></li>")
          .attr("data-customer-id", c.id)
          .attr("title", `${c.displayName} — ${statusOf(c.id)}`);
        const $dot = $("<span></span>")
          .addClass("aqb-sidebar-icon")
          .addClass(`aqb-status-${statusOf(c.id)}`);
        $li.append($dot);
        $li.append($("<span class='aqb-sidebar-name'></span>").text(c.displayName));
        if (c.id === activeId) $li.addClass("aqb-active");
        $list.append($li);
      }
    }

    function refresh() {
      bus
        .getCustomers()
        .then((res) => {
          const activeId = res.activeCustomerId;
          renderSidebar(res.customers || [], activeId);
        })
        .catch(() => {});
    }

    $host.on("click", ".aqb-sidebar-list li", function () {
      const id = $(this).data("customer-id");
      if (!id) return;
      bus
        .setActiveCustomer(id)
        .then(() => {
          // The state event from the server will repaint.
          refresh();
        })
        .catch((err) => {
          console.warn("setActiveCustomer failed:", err);
        });
    });

    // Track health for the active customer.
    bus.onChange((evt) => {
      const m = (evt.topic || "").match(/^pool\/([^/]+)\/health\/([^/]+)$/);
      if (!m) return;
      const id = m[1];
      const leaf = m[2];
      let s = customerState[id];
      if (!s) { s = { lastSeenMs: 0, mqttConnected: undefined }; customerState[id] = s; }
      s.lastSeenMs = Date.now();
      if (leaf === "mqtt_connected") {
        s.mqttConnected = unwrap(evt.payload) === true;
      }
      refresh();
    });

    bus.onState(() => refresh());
    bus.onConnection(() => refresh());

    refresh();
  }

  $(function () {
    const $host = $("#aquabutler-sidebar-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);