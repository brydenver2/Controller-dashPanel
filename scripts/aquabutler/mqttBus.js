/* AquaButler client-side MQTTBus.
 *
 * Thin wrapper over the existing dashPanel socket.io channel. The
 * Layer 1 bridge (server/aquabutler/api.ts) already emits three
 * outbound events — `aquabutler:state`, `aquabutler:change`, and
 * `aquabutler:connection` — and Layer 2 added `aquabutler:audit`.
 *
 * Layer 2 widgets use this bus instead of opening new sockets because:
 *   - One socket per page (the existing one); we don't fragment.
 *   - The server-side already enforces the per-customer ACL. Opening
 *     a parallel client from the browser would require carrying
 *     mqtts:// creds across the wire, which the dashboard refuses.
 *   - Reads AND writes go through the same channel: the bus exposes
 *     `publishManualCommand`, `publishServiceCommand` as POST helpers.
 *
 * jQuery is already loaded by the rest of the dashPanel; we use it
 * for ajax and to attach to the existing `window.io` socket.
 *
 * Returns a singleton — multiple widgets share one socket connection.
 */
(function () {
  "use strict";

  let _sock = null;
  const _auditCallbacks = new Set();
  const _changeCallbacks = new Set();
  const _stateCallbacks = new Set();
  const _connCallbacks = new Set();

  function ensureSocket() {
    if (_sock) return _sock;
    if (!window.io) {
      console.warn(
        "AquaButler MQTTBus: window.io not loaded; widgets will not receive live state.",
      );
      return null;
    }
    _sock = window.io();
    _sock.on("aquabutler:state", (data) => {
      for (const cb of _stateCallbacks) {
        try { cb(data); } catch (e) { console.error("state cb:", e); }
      }
    });
    _sock.on("aquabutler:change", (data) => {
      for (const cb of _changeCallbacks) {
        try { cb(data); } catch (e) { console.error("change cb:", e); }
      }
    });
    _sock.on("aquabutler:audit", (data) => {
      for (const cb of _auditCallbacks) {
        try { cb(data); } catch (e) { console.error("audit cb:", e); }
      }
    });
    _sock.on("aquabutler:connection", (data) => {
      for (const cb of _connCallbacks) {
        try { cb(data); } catch (e) { console.error("conn cb:", e); }
      }
    });
    return _sock;
  }

  function bypassOn() {
    return (
      document.documentElement.getAttribute("data-aquabutler-bypass") === "1" ||
      new URL(window.location.href).searchParams.get("xaqb") === "1"
    );
  }

  function postJson(url, body) {
    const headers = { "Content-Type": "application/json" };
    if (bypassOn()) headers["X-AquaButler-Bypass"] = "1";
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
    }).then((r) => {
      // Surface non-2xx with a structured body so the widget can show
      // the reason (e.g. rejected_safety).
      if (!r.ok) {
        return r.text().then((text) => {
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}
          const err = new Error(`HTTP ${r.status}`);
          err.status = r.status;
          err.body = parsed || text;
          throw err;
        });
      }
      return r.json();
    });
  }

  function getJson(url, query) {
    const headers = {};
    if (bypassOn()) headers["X-AquaButler-Bypass"] = "1";
    const u = new URL(url, window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      }
    }
    return fetch(u.toString(), { headers, credentials: "same-origin" }).then(
      (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      },
    );
  }

  /**
   * Compute sha256:<hex> of `pin` via Web Crypto. Returns the canonical
   * `sha256:<64hex>` string the schema requires (see
   * ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §service/set).
   */
  async function sha256Hex(pin) {
    const enc = new TextEncoder().encode(pin);
    const buf = await window.crypto.subtle.digest("SHA-256", enc);
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return "sha256:" + hex;
  }

  const busInstance = {
    /** Ensure the socket is connected; idempotent. */
    connect() { ensureSocket(); },

    /** Subscribe to live state changes (whole-snapshot). */
    onState(cb) { _stateCallbacks.add(cb); ensureSocket(); return () => _stateCallbacks.delete(cb); },

    /** Subscribe to per-leaf updates. */
    onChange(cb) { _changeCallbacks.add(cb); ensureSocket(); return () => _changeCallbacks.delete(cb); },

    /** Subscribe to audit-log appends. */
    onAudit(cb) { _auditCallbacks.add(cb); ensureSocket(); return () => _auditCallbacks.delete(cb); },

    /** Subscribe to connection-state changes. */
    onConnection(cb) { _connCallbacks.add(cb); ensureSocket(); return () => _connCallbacks.delete(cb); },

    /** GET /aquabutler/state — snapshot. */
    getState() { return getJson("/aquabutler/state"); },

    /** GET /aquabutler/customers — list. */
    getCustomers() { return getJson("/aquabutler/customers"); },

    /** POST /aquabutler/active-customer. */
    setActiveCustomer(customerId) {
      return postJson("/aquabutler/active-customer", { customerId });
    },

    /** POST /aquabutler/command/manual. */
    publishManualCommand(action, params) {
      return postJson("/aquabutler/command/manual", { action, params });
    },

    /** POST /aquabutler/command/service. */
    publishServiceCommand(action, payload) {
      return postJson("/aquabutler/command/service", Object.assign({ action }, payload));
    },

    /** GET /aquabutler/audit — paginated recent entries. */
    getAudit(opts) {
      return getJson("/aquabutler/audit", {
        stream: opts?.stream,
        limit: opts?.limit,
        offset: opts?.offset,
      });
    },

    /** Trigger a CSV download of the audit log. */
    downloadAuditCsv(opts) {
      const u = new URL("/aquabutler/audit.csv", window.location.origin);
      if (opts?.stream) u.searchParams.set("stream", opts.stream);
      if (opts?.limit) u.searchParams.set("limit", String(opts.limit));
      // Browser download via temporary anchor (preserves bypass header
      // via cookie; we don't carry the bypass header here, but the
      // bypass mode also flips a cookie-less flow — see authFlow.js).
      window.location.assign(u.toString());
    },

    /** Compute sha256(pin) → "sha256:<64hex>". */
    sha256Hex,

    /** True iff auth-bypass mode is active (?xaqb=1 or data attr). */
    isBypass() { return bypassOn(); },
  };

  window.AquaButlerBus = busInstance;
})();