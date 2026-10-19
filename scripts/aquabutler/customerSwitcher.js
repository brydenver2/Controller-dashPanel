/* AquaButler customer switcher UI.
 *
 * Renders a top-bar dropdown of configured customers and emits
 * `POST /aquabutler/active-customer` on every selection. The server
 * tears down the existing MQTT subscription and creates a fresh one
 * scoped to the new customer's `pool/<id>/#`, so there is no topic
 * leak between customers.
 *
 * jQuery 4 + jQuery UI 1.14 are already loaded by the rest of the
 * dashPanel (see server/Server.ts lines 156-160). We use them here.
 *
 * Layer 1 has no `add` / `remove` flow — customers are added at
 * commissioning by the cluster (per the spec, that's not the
 * dashPanel's job). The UI is read-only with a `reload` affordance.
 *
 * Auth: until the Supabase auth strategy lands (t_ea19acd3), the
 * optional `?xaqb=1` query string flips on the X-AquaButler-Bypass
 * header so techs in the field can still drive the dashboard.
 */
(function ($) {
  "use strict";
  const state = {
    customers: [],
    activeCustomerId: null,
    bypass: false,
  };

  function postJson(url, body) {
    const headers = { "Content-Type": "application/json" };
    if (state.bypass) headers["X-AquaButler-Bypass"] = "1";
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }

  function getJson(url) {
    const headers = {};
    if (state.bypass) headers["X-AquaButler-Bypass"] = "1";
    return fetch(url, { headers, credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }

  function renderDropdown($host) {
    // The AquaButler brand chip is rendered statically in
    // pages/aquabutler/customerSwitcher.html (Layer 3 — see
    // docs/wiki/2026-10-19-dashpanel-aquabutler-layer3.md). DO NOT empty
    // $host: only append the dropdown + connection pill after the chip.
    // Removing the chip would erase the AquaButler identity.
    const $brand = $host.find(".aqb-brand").first();
    $host.find("select, #aquabutler-conn").remove();

    const $select = $("<select id='aquabutler-customer'></select>");
    if (state.customers.length === 0) {
      $select.append(
        $("<option></option>").val("").text("— no customers configured —"),
      );
    } else {
      $select.append($("<option></option>").val("").text("Select customer…"));
      for (const c of state.customers) {
        $select.append(
          $("<option></option>")
            .val(c.id)
            .text(c.displayName)
            .prop("selected", c.id === state.activeCustomerId),
        );
      }
    }
    if ($brand.length > 0) {
      $brand.after($select);
    } else {
      $host.append($select);
    }
    $host.append(
      $(
        "<span id='aquabutler-conn' class='aquabutler-pill'>offline</span>",
      ),
    );
  }

  function setConnectionLabel(text, kind) {
    const $el = $("#aquabutler-conn");
    if ($el.length === 0) return;
    $el.text(text);
    $el.removeClass("aquabutler-pill-good aquabutler-pill-bad");
    $el.addClass(`aquabutler-pill-${kind}`);
  }

  function bootstrap($host) {
    const url = new URL(window.location.href);
    state.bypass = url.searchParams.get("xaqb") === "1";

    getJson("/aquabutler/customers")
      .then((data) => {
        state.customers = data.customers;
        state.activeCustomerId = data.activeCustomerId;
        renderDropdown($host);
      })
      .catch((err) => {
        $host.text(`AquaButler not available: ${err.message}`);
      });

    $host.on("change", "#aquabutler-customer", function () {
      const id = $(this).val();
      if (!id) return;
      setConnectionLabel("switching…", "pending");
      postJson("/aquabutler/active-customer", { customerId: id })
        .then((data) => {
          state.activeCustomerId = data.activeCustomerId;
          setConnectionLabel("connected", "good");
        })
        .catch((err) => {
          setConnectionLabel("error: " + err.message, "bad");
        });
    });

    // Subscribe to the bridge events the server emits.
    if (window.io) {
      const sock = window.io();
      sock.on("aquabutler:state", (data) => {
        state.activeCustomerId = data.activeCustomerId;
        $("#aquabutler-customer").val(data.activeCustomerId || "");
      });
      sock.on("aquabutler:connection", (data) => {
        if (data.state === "connected") {
          setConnectionLabel("connected", "good");
        } else if (data.state === "disconnected") {
          setConnectionLabel("offline", "bad");
        } else {
          setConnectionLabel(data.state, "pending");
        }
      });
      sock.on("aquabutler:change", (_data) => {
        // Layer 2 widgets consume this directly; Layer 1 only needs to
        // know that something is changing (unspecified UI here yet).
      });
    }
  }

  $(function () {
    const $host = $("#aquabutler-customer-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);
