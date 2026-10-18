# AquaButler DashPanel — Layer 1 (Multi-Tenant Shell)

> **Owner:** Friday (per AquaButler spoke model — code work for `~/Controller-dashPanel/`)
> **Card:** `t_540065f7`
> **Branch:** `feat/aquabutler-multitenant-layer1-t_540065f7`
> **Status:** Layer 1 shipped, 46/46 tests passing, Layers 2 + 3 child cards filed.

## Overview

The AquaButler fork of `nodejs-poolcontroller-dashPanel` evolves from a single-tenant hobbyist UI into a multi-tenant field-tech UI. Layer 1 is the foundational plumbing — per-customer config, per-customer MQTT client, top-bar customer switcher, additive to the existing local-socket path.

**What works after this layer:**
- Techs log in (dev path: `?xaqb=1`; production path: wires up once `t_ea19acd3` lands).
- The dashPanel reads `customers.json` (or the `aquabutler.customers` block in `config.json`) for the list of customers the tech can access.
- The dashPanel connects to `mqtt.aquabutlers.com:8883` (TLS, per-customer credentials) and subscribes only to the active customer's `pool/<id>/#`. Other customers are unreachable.
- The tech uses a top-bar dropdown to switch customers. Switching tears down the existing MQTT subscription and instantiates a fresh one scoped to the new customer's `pool/<id>/#` — no leak between customers.
- Per-customer state updates land in the in-memory `PoolStateStore`, surfaced to the browser over the existing Socket.IO channel.
- Layer 2 widgets (filed in `t_3e66bc7f`) read from this state store.

## Architecture

```
            ┌──────────────────────────┐
            │ Express app (Server.ts)  │
            │  /aquabutler/{customers, │
            │   active-customer,state} │
            │  ┌───────────────────┐   │
            │  │ AquaButlerRoute   │   │
            │  │ (api.ts)          │   │
            │  └─────┬────────┬────┘   │
            └────────┼────────┼────────┘
                     │        │ Socket.IO events
        ┌────────────▼──┐  ┌──▼───────────┐
        │ AquaButlerRoute│  │ Socket.IO    │
        │ (HTTP routes)  │  │ (existing)   │
        └───────┬────────┘  └──────────────┘
                │
       ┌────────▼─────────┐
       │ AquaButlerFleet  │  EventEmitter: active-changed, message, connect, close
       │ (fleet.ts)       │  holds at most ONE PerCustomerMqttClient
       └───────┬──────────┘
               │
       ┌───────▼──────────────┐    ┌────────────────────┐
       │ PerCustomerMqttClient│───▶│ mqtt.MqttClient    │──→ mqtts://mqtt.aquabutlers.com:8883
       │ (mqttClient.ts)      │    │ customer_<id>/...  │
       └──────────────────────┘    └────────────────────┘
```

**Server-side file map** (all under `server/aquabutler/`):
- `mqttTopics.ts` — canonical topic constants from the schema v1.0 doc.
- `customerConfig.ts` — `customers.json` + env-var overrides + validation.
- `mqttClient.ts` — per-customer TLS MQTT client wrapper.
- `fleet.ts` — at-most-one active client, switching tears down the prior.
- `poolState.ts` — in-memory last-value-wins store, surfaces events.
- `api.ts` — REST routes + Socket.IO bridge.
- `authMiddleware.ts` — STUB until Vision's `t_ea19acd3` lands.
- `index.ts` — boot entry point wired into `app.ts`.
- `loggerSafe.ts` — tolerant logger wrapper for tests.

**Client-side** (under `scripts/aquabutler/`):
- `customerSwitcher.js` — jQuery 4 top-bar widget.
- `authFlow.js` — `?xaqb=1` dev bypass.

**Tests** (under `server/aquabutler/__tests__/`):
- `mqttTopics.test.ts` — 11 tests
- `customerConfig.test.ts` — 10 tests
- `poolState.test.ts` — 7 tests (includes regression coverage for the chem/dosing/config/audit group pre-init fix)
- `mqttClient.test.ts` — 6 tests
- `fleet.test.ts` — 7 tests
- `authMiddleware.test.ts` — 5 tests

Run with: `npm test` or `npm run test:fast` (after a build).

## Operation

> **TBD — @ultron_wallace_bot.** This section is intentionally empty. Ultron owns the field-install playbook for the dashPanel's AquaButler mode (which env vars to set, what TLS root to bundle, what to do if the broker connection stays "connecting…" forever).

## Configuration

Per-customer configuration is loaded additively from `defaultConfig.json` (the field defaults live there) and overlay'd by `config.json` (operator overrides). Env-var overrides take precedence over both.

**File shape** in `defaultConfig.json` (already merged) or `config.json`:

```jsonc
{
  "aquabutler": {
    "enabled": true,                     // POOL_AQUABUTLER_ENABLED also works
    "broker": {
      "url": "mqtts://mqtt.aquabutlers.com:8883",
      "clientIdPrefix": "dashpanel"      // POOL_AQUABUTLER_BROKER_CLIENTID_PREFIX overrides
    },
    "activeCustomerId": null,            // POOL_AQUABUTLER_ACTIVE_CUSTOMER_ID overrides
    "customers": [
      {
        "id": "abc-12345",               // 8-64 chars of alphanumeric or dash
        "displayName": "Goldin Residence",
        "username": "customer_abc-12345", // MUST start with "customer_<id>" per schema ACL
        "passwordRef": "env:AQUABUTLER_CUST_ABC_12345_PWD",
        "permissionScope": "tech"        // or "readonly"
      }
    ]
  }
}
```

**Env-var pattern** for per-customer credentials (never log the values):

```sh
POOL_AQUABUTLER_ENABLED=true
POOL_AQUABUTLER_BROKER_URL=mqtts://mqtt.aquabutlers.com:8883
POOL_AQUABUTLER_ACTIVE_CUSTOMER_ID=abc-12345
AQUABUTLER_CUST_ABC_12345_PWD=…
# repeat per customer
```

The dashPanel refuses to connect if `passwordRef` doesn't start with `env:` (Layer 1 scope; future revisions may add `vault:infisical:...`).

## Troubleshooting

> **TBD — @ultron_wallace_bot.** Same as Operation above.

Initial symptoms and how to read them:

- **Top-bar dropdown says "— no customers configured —"** → either `aquabutler.enabled` is false or the `customers` array is empty. Check `defaultConfig.json` + `config.json` + `POOL_AQUABUTLER_ENABLED`.
- **Dropdown shows customers but "switching…" hangs forever** → `POOL_AQUABUTLER_ENABLED=true` is set but no MQTT broker reachable from this Pi. Check `mosquitto` networking on the Aqua Swarm (`@ultron_wallace_bot` lane).
- **401 on every AquaButler request** → auth middleware is gating. Either set `?xaqb=1` query (dev only) or land `t_ea19acd3` (Supabase auth).
- **Cross-customer data leak / duplicate subscriptions** → bug in fleet teardown logic. `grep -n "switchCustomer" server/aquabutler/fleet.ts` and verify `_teardownActive` runs before the new client connects. Run `npm test` for a regression check.

## Dependencies

- **MQTT broker**: `mqtt.aquabutlers.com:8883` (TLS, ACM issued). Owned by `@ultron_wallace_bot` per `~/AquaButler-Server/AGENTS.md`.
- **Per-customer credentials**: issued by the cluster at commissioning, stored in the customer's portal entry (`~/AquaButler-Server/bridge/...`). Owned by the cluster side, not the dashPanel.
- **Canonical MQTT topic schema**: `~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md` v1.0 — owned by `@shuri`.
- **Auth**: Supabase auth flow (`t_ea19acd3`) — owned by `@vision_wallace_bot`. Layer 1 ships a STUB that returns 401 without the bypass header. Production cannot be deployed with the STUB; Vision's card is the gate.
- **Rotary display firmware**: `~/AquaButler-Server/src/rotary_display/` — sibling consumer of the same `pool/<id>/...` topics. Topic-name alignment check is filed as `t_17b00b59`.

## See Also

- Spec: `~/Obsidian/Vault/Infrastructure/Agent-Operations/njsPC-dashboard-modernization.md`
- Canonical schema doc: `~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md`
- Cluster roadmap: `~/Obsidian/Vault/Infrastructure/Mission-Control/AquaButler-cluster-roadmap.md`
- Child cards filed from this layer:
  - `t_ea19acd3` — Vision: Supabase auth
  - `t_3e66bc7f` — Friday: Layer 2 widgets
  - `t_1e9f6f85` — Friday: Layer 3 theming
  - `t_17b00b59` — Friday: shared constants module (firmware ↔ dashPanel)
- Repo: `~/Controller-dashPanel/AGENTS.md` (the dashPanel's own agent guidelines)
- Sibling kanban: `t_df32b2f9` (rotary display firmware, closed 2026-10-18)
- Library docs: `mqtt` (npm) v5.16.1 — MQTT.js. Pure JS, works in Node 16+.

— Friday, 2026-10-18, on `feat/aquabutler-multitenant-layer1-t_540065f7`
