# AquaButler dashPanel — Layer 2 widgets

> **Author:** Friday (njsPC dashPanel fork owner)
> **Branch:** `feat/aquabutler-layer2-widgets-t_3e66bc7f`
> **Status:** committed locally, ready for review (kanban `t_3e66bc7f`)
> **Reviewers:** Ultron (broker / cluster integration), Shuri (schema v1.0 ownership), Vision (cross-customer ops)
> **Cross-references:**
> - Layer 1 wiki: `docs/wiki/2026-10-18-dashpanel-aquabutler-layer1.md` (must be merged first; provides the per-customer MQTT client + Socket.IO bridge this layer depends on)
> - Canonical schema: `~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md` v1.0 (every topic literal in this layer is derived from there — see §Architecture)

## Overview

Layer 2 ships **five read/write widgets** plus two shared client-side modules and three server-side endpoints. It builds on Layer 1's per-customer MQTT client and Socket.IO bridge; nothing in this layer opens a parallel MQTT connection from the browser.

| Widget | DOM host | Topic touch |
|---|---|---|
| Per-customer live state | `#aquabutler-live-state-host` | reads `pool/<id>/telemetry/*`, `pool/<id>/status/*`, `pool/<id>/health/mqtt_connected` |
| Rotary display audit log | `#aquabutler-audit-log-host` | reads `pool/<id>/audit/{manual,service,dashpanel_action}` |
| Service mode | `#aquabutler-service-mode-host` | writes `pool/<id>/command/service/set`, reads `pool/<id>/service/state` |
| Manual command | `#aquabitler-manual-command-host` | writes `pool/<id>/command/manual/{pump,filter,chlorination,heater}/set`, writes `pool/<id>/audit/dashpanel_action` |
| Customer switcher sidebar | `#aquabutler-sidebar-host` | reads `pool/<id>/health/mqtt_connected` (active customer only) |

The widgets are designed to be **mounted together** on a single tech-facing page (e.g., a future `pages/aquabutler/overview.html`), but each is independently droppable onto any page that already loads jQuery + socket.io + `scripts/aquabutler/mqttBus.js`.

## Architecture

### Client side

```
                              scripts/aquabutler/
                              ├── mqttBus.js          # socket.io singleton wrapper
                              ├── auditEnvelope.js    # schema v1.0 §audit envelope preview
                              └── widgets/
                                  ├── liveState.{html,js}
                                  ├── auditLog.{html,js}
                                  ├── serviceMode.{html,js}
                                  ├── manualCommand.{html,js}
                                  └── customerSidebar.{html,js}
```

**`mqttBus.js`** is the single client-side seam. It owns one socket.io connection (re-using the existing `window.io()` channel the rest of the dashPanel uses — no new sockets), and exposes four subscribe APIs (`onState`, `onChange`, `onAudit`, `onConnection`) plus four write APIs (`setActiveCustomer`, `publishManualCommand`, `publishServiceCommand`, `downloadAuditCsv`). The `sha256Hex` API is the Web Crypto path used by the service mode widget — the PIN never leaves the browser in cleartext.

**`auditEnvelope.js`** mirrors the schema v1.0 §audit envelope shape on the client so the UI can render preview rows and the audit log widget's CSV export matches the on-the-wire schema exactly. The server is the canonical emitter; this module is purely cosmetic.

The five widgets share no DOM; each scopes its queries to its own `*-host` element so multiple widgets can coexist on one page.

### Server side

```
                              server/aquabutler/
                              ├── mqttClient.ts       # +publishAudit(), AuditEnvelope type
                              ├── poolState.ts        # unchanged from Layer 1 (still last-value-wins)
                              ├── auditLog.ts         # NEW — per-stream ring buffer for active customer
                              ├── api.ts              # +/command/manual, +/command/service, +/audit, +/audit.csv
                              └── __tests__/
                                  ├── auditLog.test.ts        # NEW (6 tests)
                                  └── apiCommands.test.ts     # NEW (9 tests)
```

**`auditLog.ts`** is a sibling store to `poolState.ts`. It keeps **ordered append** semantics (last-value-wins would lose intermediate entries). The bridge populates it from any inbound `pool/<id>/audit/<stream>` message; the active customer's `setActiveCustomer(null)` resets the buffer.

**`api.ts`** adds four endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/aquabutler/command/manual` | POST | Publish a pump/filter/chlorination/heater command; runs the chlorination safety interlock; writes a paired audit entry. |
| `/aquabutler/command/service` | POST | Enter/exit/force_exit service mode; sha256: pin_hash required for enter+exit; force_exit stamps `auth.source = "cloud"`. |
| `/aquabutler/audit` | GET | Paginated JSON, newest-first, optional stream filter. |
| `/aquabutler/audit.csv` | GET | CSV download (default limit 1000, max 10000), `Content-Disposition: attachment`. |

**`checkChlorinationInterlock(state)`** is the canonical safety gate. It reads `state.current["chem"].orp` (the schema v1.0 §chem/orp value, after the `poolState` envelope unwrap). It returns `{ok: false, reason: ...}` for any of:

- `chem/orp` has not arrived yet (fail-closed)
- `chem/orp` is `NaN` / `null` / not a finite number
- `chem/orp >= 800` (boundary at exactly 800 refuses)

When the interlock refuses, the handler writes a paired `audit/dashpanel_action` entry with `outcome: "rejected_safety"` and `error: "chlorination_lockout_800mV (<reason>)"` — **no command is published**. This is the schema-mandated durability: every action (including refused ones) shows up in the audit log.

### Safety UX

- **30-second confirmation window** on every manual command and every service-mode action (matches the rotary firmware's safety UX per `t_df32b2f9`).
- **Pre-publish interlock** for chlorination: client AND server gate independently against `chem/orp >= 800`. The client-side gate is a UX hint (disables the button, shows "LOCKED OUT"); the server-side gate is authoritative.
- **PIN never leaves the browser in cleartext**: `window.crypto.subtle.digest("SHA-256", ...)` produces `"sha256:<64hex>"`; that's what crosses the wire. The server forwards it to njsPC/REM which combines with the HAT ID install-date+salt before comparing.
- **Force-exit must come from a cloud account** per §service/set. The dashPanel still sends it (the broker / njsPC is the gate) but stamps `auth.source: "cloud"` on the publish so the audit trail records it correctly.

### Card-body vs schema divergences (resolved)

Three places in the original kanban card body used topic names that don't match schema v1.0. The schema is authoritative (per the SOUL.md source-of-truth hierarchy); this layer implements against the schema and the wiki flags the divergence so reviewers can confirm:

| Card body | Schema v1.0 | This layer uses |
|---|---|---|
| `pool/<id>/health/comm` (live state cell + audit row) | `pool/<id>/health/mqtt_connected` (flat per-metric tree per §health) | `health/mqtt_connected` |
| `pool/<id>/health/system` (sidebar status icon source) | flat `pool/<id>/health/<check>` per metric (no `health/system` aggregate) | rolled up from `health/mqtt_connected` + freshness window |
| `pool/<id>/telemetry/orp_mV` for chlorination interlock | `pool/<id>/chem/orp.value < 800` (§Write topics table) | `chem/orp` |

The display widget still uses `telemetry/orp_mV` for the **ORP display value** (that IS a valid schema leaf — it's the rotary display's source-of-truth reading), and `chem/orp` for the **safety interlock** (the schema-mandated pre-publish check).

## Configuration

No new config keys. Layer 2 inherits everything from Layer 1's `aquabutler` config block:

- `POOL_AQUABUTLER_ENABLED=true` to opt in (otherwise the layer is a no-op)
- `aquabutler.customers` array in `defaultConfig.json` / `config.json` for the customer list
- `POOL_AQUABUTLER_BROKER_URL` for the MQTT broker

The per-customer telemetry required by the widgets (pH, ORP, pump state, chem/orp, mqtt_connected) is produced upstream by njsPC and REM; this layer only consumes it.

## Operation

> **TBD — @ultron_wallace_bot** runs the in-context flow (real broker + real customer) and fills this in. The expected sections are:
>
> - How to mount the five widgets on a single tech-facing page (the host `<div>` ids and the `<script>` include order)
> - How to verify the chlorination safety interlock fires (push a fake `chem/orp=850` to a test customer and confirm the button is disabled + the manual publish returns 409 + the audit log gets a `rejected_safety` entry)
> - How to verify the audit log live-updates (publish a fake `pool/<id>/audit/manual` entry from a second MQTT client and confirm the row appears without a page reload)
> - How to trigger the CSV export and what filename to expect
>
> If this section ships empty, **do not** mark the layer production-ready — Layer 2 cannot ship to a field tech without an in-context smoke run.

## Troubleshooting

> **TBD — @ultron_wallace_bot.** The expected failure modes are:
>
> - Widgets blank after page load: usually the `?xaqb=1` bypass missing (until Vision's Supabase auth ships, the dashboard returns 401 outside dev bypass and the snapshot fetch fails). Check the browser network tab.
> - Chlorination button permanently disabled: `chem/orp` telemetry hasn't arrived for the active customer yet (fail-closed default). Check the njsPC is publishing and the broker ACL allows `pool/<id>/chem/orp` reads.
> - "OFFLINE > 2 min" banner won't clear: no message of ANY topic for the active customer in >120s. Usually broker disconnect; check the connection pill in the top-bar switcher.
> - Audit log shows the dashPanel's own entries (dashpanel_action stream) but not rotary manual entries: the rotary firmware's `pool/<id>/audit/manual` publish is failing or the broker ACL is blocking the `device_rotary_*` user. Check Mosquitto dynamic-security config.
> - 409 `rejected_safety` on chlorination without a visible ORP reading: the sensor is down or `chem/orp` value is being filtered out at the bridge layer.
>
> If this section ships empty, treat any field-tech incident report as needing a triage step before assigning.

## Dependencies

- **Layer 1** (`t_540065f7`, merged into commit `392169d`) — the per-customer MQTT client + Socket.IO bridge + REST router. Layer 2 doesn't add any HTTP server or socket.io wiring of its own.
- **Schema v1.0** (`~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md`) — every topic string in this layer is a derived constant from `server/aquabutler/mqttTopics.ts` (Layer 1) or a schema-validated suffix from `mqttClient.ts:auditSuffix` (Layer 2). When v1.1 ships, bump `AQUABUTLER_MQTT_SCHEMA_VERSION` and refactor.
- **Rotary firmware** (`t_df32b2f9`, shipped commit `dfa1a45`) — produces `pool/<id>/audit/manual` and `pool/<id>/audit/service` entries; the audit log widget renders these alongside our own `dashpanel_action` entries.
- **Supabase auth** (`t_ea19acd3`, owned by `@vision_wallace_bot`) — gate to production. Today the dashboard runs with a `?xaqb=1` dev bypass that returns 401 otherwise.
- **Layer 3 theming** (`t_1e9f6f85`) — owns the AquaButler branding pass; today's widgets render with bare-bones inline styles so the page is usable in CI/QA without the theming layer.

### Open cross-agent follow-ups (flagged for Ultron + Shuri)

- **`pin_hash` derivation ambiguity** — **RESOLVED 2026-10-18 (commit `d0359` on `feat/aquabutler-layer2-widgets-t_3e66bc7f`)**. Spec doc-fix landed at `94bbe3c` on `feat/aquabutler-cloud-specs-t_927c81db` (kanban `t_65eb3a67`, owned by `@shuri`). Locked at Option A: `pin_hash = "sha256:" + lower_hex(sha256(utf8(pin_string)))` — 64 lowercase hex, no normalization. All three consumers (dashPanel widget `serviceMode.js`, dashPanel server `api.ts:sha256Hex`, rotary firmware `service_mode.py:172-175` + `hat_eeprom.py:222-227`) already shipped Option A; only the comments were stale. v1.1 hardening (cluster-secret HMAC, Option C, schema open question §9.12) deferred behind per-stack Infisical project (gap `t_9b913b50`); prefix will switch to `sha256-hmac:` when that lands. Regression test `sha256Hex: pin_hash known values (Option A, schema v1.0)` in `server/aquabutler/__tests__/apiCommands.test.ts` pins the derivation to constants from `hashlib`.
- **`health/<check>` coverage**: the dashboard's sidebar and live-state widget only read `health/mqtt_connected` for the comm indicator. A future Layer 3+ consumer might want cpu_temp_c / memory_pct / disk_pct / signal_strength aggregated into a single green/yellow/red rollup. Out of scope for this commit but the `health/<check>` topic tree makes it cheap to add.
- **Fleet view**: a future "show all customers' status icons simultaneously" requires a read-only monitoring account subscribing to `pool/+/health/#` cross-customer. Not in scope; flagged in `fleet.ts` Layer 1 comment.

## See also

- `~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md` — canonical schema v1.0 (Shuri, 2026-10-18)
- `~/AquaButler-Server/AGENTS.md` — cluster isolation rules + reviewer sign-off process
- `~/AquaButler-Server/docs/wiki/` — sibling docs (rotary firmware brief, rotary canonical messages, cluster roadmap)
- `Controller-dashPanel/docs/wiki/2026-10-18-dashpanel-aquabutler-layer1.md` — Layer 1 wiki (parent)
- `Controller-dashPanel/AGENTS.md` — fork-only rules for this branch
- Kanban: `t_3e66bc7f` (this card), `t_540065f7` (Layer 1 parent), `t_ea19acd3` (Vision: Supabase auth), `t_17b00b59` (shared constants module follow-up), `t_1e9f6f85` (Layer 3 theming)