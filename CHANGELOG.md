# Changelog

## [Unreleased] - AquaButler fork

### Features
- **Multi-tenant MQTT shell (Layer 1)**: env-gated (`POOL_AQUABUTLER_ENABLED=true`) per-customer MQTT client connected to `mqtt.aquabutlers.com:8883`, subscribed only to the active customer's `pool/<id>/#`. Customer switcher UI (top-bar jQuery 4 widget) tears down the existing client before building the new one — no leak between customers.
- **Schema-aligned topic constants**: every publish/subscribe path goes through `server/aquabutler/mqttTopics.ts`, derived verbatim from the canonical `~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md` v1.0 (Shuri, 2026-10-18). Future schema revisions bump the version constant and refactor.
- **Authentication stub**: returns 401 until `t_ea19acd3` (Vision: Supabase auth) lands. Dev/test bypass via `?xaqb=1` URL param or `X-AquaButler-Bypass: 1` header.
- **Customer switcher UI**: top-bar dropdown + connection pill; lives at `pages/aquabutler/customerSwitcher.html` + `scripts/aquabutler/customerSwitcher.js`.
- **REST + Socket.IO integration**: `GET /aquabutler/{customers, state}`, `POST /aquabutler/active-customer`. Live state streamed via the existing Socket.IO channel under `aquabutler:{state, change, connection}` events.
- **Test infra**: `npm test` runs 46 unit tests across 6 files (mqtt topics / customer config / pool state / MQTT client / fleet orchestrator / auth middleware). Layer 1 changes ship with green tests and no upstream regressions.

### Architecture
- **Additive by design**: when `POOL_AQUABUTLER_ENABLED` is unset/false, the entire layer is a no-op — the upstream hobbyist single-tenant local-socket flow is unchanged.
- **Schema in code, not in JSON**: the `aquabutler.customers` block in `defaultConfig.json` / `config.json` is the per-customer config; all topics are derived constants, never hand-typed at publish/subscribe sites.
- **Library**: `mqtt` (MQTT.js) v5.16.1 — pure-JS, Node 16+. Pin via `package.json`.

### Coordination
- Layer 2 widgets (live state, audit log, service mode, manual command, customer sidebar) tracked in `t_3e66bc7f`.
- Layer 3 theming tracked in `t_1e9f6f85`.
- Auth strategy (Supabase) tracked in `t_ea19acd3` — owned by `@vision_wallace_bot`.
- Shared constants module (firmware ↔ dashPanel drift prevention) tracked in `t_17b00b59`.

### Features (Layer 2 — five AquaButler widgets)
- **Per-customer live state widget** (`scripts/aquabutler/widgets/liveState.{html,js}`): renders pH, ORP, pump state+RPM, pool/air °F, heater setpoint, mode, last_error, errors_24h, WiFi dBm, and a real online/offline pulse on `health/mqtt_connected`. Last-state-wins with a 2s fade; 120s without any message flips the canonical "OFFLINE > 2 min" red banner.
- **Rotary display audit log widget** (`scripts/aquabutler/widgets/auditLog.{html,js}`): paginated table (last 100 entries, prev/next pager), per-stream filter (manual | service | dashpanel_action | all), CSV export button (`/aquabutler/audit.csv`). Live append via `aquabutler:audit` socket events.
- **Service mode widget** (`scripts/aquabutler/widgets/serviceMode.{html,js}`): enter/exit/force-exit with 30s confirmation window. Enter+exit require a 4-digit PIN; SHA-256 hashing happens client-side via Web Crypto SubtleCrypto and only `sha256:<hex>` crosses the wire.
- **Manual command widget** (`scripts/aquabutler/widgets/manualCommand.{html,js}`): pump on/off, filter cycle (1-12 hr), chlorination override (target_orp_mV + duration_min with 10-min hard cap), heater target (60-104 °F). Chlorination is client+server gated against `chem/orp >= 800` per schema v1.0 §Write topics; fail-closed if telemetry hasn't arrived. Every successful publish writes a paired `pool/<id>/audit/dashpanel_action` entry.
- **Customer switcher sidebar** (`scripts/aquabutler/widgets/customerSidebar.{html,js}`): at-a-glance green/yellow/red status icon per customer (driven by `health/mqtt_connected` and a 120s freshness window). Click delegates to the existing Layer 1 `setActiveCustomer` handler.
- **Client-side `MQTTBus`** (`scripts/aquabutler/mqttBus.js`): singleton wrapper over the existing socket.io channel — exposes `connect/onState/onChange/onAudit/onConnection/getState/getCustomers/setActiveCustomer/publishManualCommand/publishServiceCommand/getAudit/downloadAuditCsv/sha256Hex/isBypass`. No new sockets; per-customer ACL stays enforced server-side.
- **Audit envelope builder** (`scripts/aquabutler/auditEnvelope.js`): client-side preview that mirrors the schema v1.0 §audit envelope shape; the server is the canonical emitter, this is purely for instant UI feedback and CSV export shape parity.

### Server (Layer 2 additions)
- **Per-customer audit buffer** (`server/aquabutler/auditLog.ts`): `AuditLogStore` keeps a per-stream ring buffer (default capacity 100 per stream) for the active customer; emits `appended` for the live socket event; bounded by `setActiveCustomer` resets.
- **Command endpoints** (`server/aquabutler/api.ts`):
  - `POST /aquabutler/command/manual` — pump/filter/chlorination/heater. Chlorination runs `checkChlorinationInterlock(state)` against `chem/orp`; on refusal returns `409 rejected_safety` + writes a `rejected_safety` audit entry (no command publish). Successful publishes write a paired `executed` audit entry. Broker publish failures write a paired `failed` audit entry.
  - `POST /aquabutler/command/service` — enter/exit/force_exit. Enter+exit require `sha256:` pin_hash; force_exit stamps `auth.source = "cloud"` per §service/set schema.
  - `GET /aquabutler/audit` (paginated JSON) and `GET /aquabutler/audit.csv` (CSV download).
- **Pre-publish safety interlock** (`server/aquabutler/api.ts:checkChlorinationInterlock`): fails closed if `chem/orp` is missing, NaN, or `>= 800`. Boundary at exactly 800 refuses.
- **Audit publish helper** (`server/aquabutler/mqttClient.ts:publishAudit`): emits to `pool/<id>/audit/<stream>` with the schema envelope (top-level `source`/`user_id`, NOT the `auth:` wrapper commands use). QoS 1, durable.
- **Socket bridge update**: `aquabutler:audit` outbound event; inbound audit messages populate the `AuditLogStore` in parallel with the existing `aquabutler:change` event.
- **Tests**: 21 new tests added (auditLog.test.ts: 6; apiCommands.test.ts: 9 covering interlock/refusal/success/fail-closed + manual+service REST endpoints + force_exit cloud-source; existing mqttTopics/fleet tests unchanged). Total: **67/67 green** via `npm run test:fast` and clean `tsc` build.

### Features (Layer 3 — AquaButler theme + canonical messages + CSV footer)
- **New full AquaButler theme (`themes/aquabutler/`)**: navy `#0050b3` header + light `#f5f8fc` background + alert `#dc2626` palette per kanban `t_1e9f6f85`. System default font (no custom font). The AquaButler sub-mark placeholder (`aquabutler-submark-placeholder-2026-10-18.jpg`, SHA `da3f913e…`) is rendered in `.picHeader::before` so the brand identity is visible on every page that mounts the standard pool controller header.
- **AquaButler is the DEFAULT theme** (not a toggle, not an overlay on aqualinkd-dark). `pages/index.html` and `pages/messageManager.html` both pin `theme = 'aquabutler'` on every load. The previous `aqualinkd` / `aqualinkd-dark` light/dark toggle is removed; `.picThemeToggle { display: none; }` enforces the no-toggle contract for any stale localStorage entries. Any stored `dashTheme` value that isn't `aquabutler` is rewritten on next reload.
- **Customer switcher renders the AquaButler brand chip + logo** (`pages/aquabutler/customerSwitcher.html`): navy background, two-tone "AquaButler / Automation" wordmark, the sub-mark placeholder at the left of the host element. `scripts/aquabutler/customerSwitcher.js` was updated to preserve the brand chip across re-renders (the old `$host.empty()` would have wiped it on every customer list refresh).
- **CSV footer line** (`server/aquabutler/api.ts:renderAuditCsv`): every audit row is prefixed with the literal brand line `AquaButler Automation`. The CSV carries a leading `brand` column so spreadsheet parsers don't lose the value as a stray prefix. Filename pattern per `canonical-messages.md`: `aquabutler-automation-<customer_id>-<YYYY-MM-DD>.csv` (UTC date, sanitized customer id, `all` fallback when no active customer).
- **Tests**: 7 new tests added (`server/aquabutler/__tests__/auditCsv.test.ts`) covering brand-column header, brand-line prefix on every row, RFC 4180-ish escaping for cells containing commas/quotes, filename customer-id embedding, `all` fallback, and unsafe-character sanitization in the filename. Also asserts `themes/aquabutler/widgets.css` declares the navy `#0050b3` and alert `#dc2626` brand colors used by the customer switcher brand chip and offline banner. Total: **75/75 green** via `npm run test:fast` and clean `tsc` build.

### Notes for upstream merge
- All AquaButler code lives under `server/aquabutler/`, `scripts/aquabutler/`, `pages/aquabutler/`, and `docs/wiki/2026-10-18-dashpanel-aquabutler-layer1.md` — keep them in dedicated subtrees to ease the next upstream sync.
- The `aquabutler` block in `defaultConfig.json` is additive (defaults to disabled); `app.ts` and `Server.ts` modifications are minimal and guarded by the same `enabled` flag.
- 52 new tests added; no existing tests were modified (the dashPanel ships a manual smoke workflow, not unit tests, so no upstream tests to be broken).
- Layer 3 is a **directional change**: removing the aqualinkd/aqualinkd-dark toggle is intentional per Bryan's "full AquaButler theme" lock. The existing themes stay on disk for reference but are no longer selectable from the UI.
- The AquaButler sub-mark placeholder is the canonical logo until the graphic designer delivers the real mascot. Robot mascot v5 is preserved in `ultron-aquabutler/AquaButler-Hardware:main:brand/` for the designer's reference but is NOT shipped in the dashPanel theme.

## [10.0.1] - 2026-08-10

### Features
- **Dynamic controller type switching**: Model dropdown allows switching controller types at runtime; longer passwords supported for ScreenLogic ([#1220](https://github.com/tagyoureit/nodejs-poolController/discussions/1220))
- **Custom password input**: Widget system supports `inputAttrs` configuration for password-type inputs (ScreenLogic)
- **Feed body temp option**: Added `feedBodyTemp` checkbox to heater configuration for active body temperature feed

### Bug Fixes
- **Schedule isOn state**: Compute schedule active state from time window for IntelliCenter (previously relied solely on reported state)
- **Variable-speed pump detection**: Extended VS pump "on" detection to all variable-speed pump types, specifically for WebSocket implementation
- **Hidden features filtering**: Skip hidden features and cast `showInFeatures` to string to avoid rendering phantom circuits ([#1223](https://github.com/tagyoureit/nodejs-poolController/discussions/1223))
- **Trust proxy**: Enable Express trust proxy and forward protocol/ip/port headers for correct operation behind reverse proxies ([#1210](https://github.com/tagyoureit/nodejs-poolController/issues/1210))

## [10.0.0] - 2026-06-28

### Breaking Changes
- **Express 5**: Upgraded from Express 4.x to 5.x. Route wildcard syntax changed (named params required). Error middleware requires explicit typing.
- **jQuery 4**: Upgraded from jQuery 3.x to 4.0. Removed deprecated `$.isFunction()`, `$.isArray()`, `$.getScript()` usage.
- **Font Awesome 7**: Upgraded from FA 6.x to 7.x. Backward-compatible via v4-shims and v5-font-face CSS.
- **TypeScript 5.9**: Upgraded from TypeScript 4.9 to 5.9. All imports converted to default imports with `esModuleInterop`.
- **Removed jquery-ui-dist**: Replaced with the built-in `jquery-ui/dist/` bundle (1.14.x, jQuery 4 compatible).
- **Removed jquery-ui-touch-punch-c**: Vendored into `scripts/vendor/` with jQuery 4 compatibility patch.

### Features
- **IntelliCenter v3 OCP WebSocket**: New `ocpws` port type for direct local WebSocket connection to IntelliCenter v3 OCP (port 6680). Includes mDNS discovery, connection testing, reconnect/timeout settings, and real-time stats via `icwsStats` socket event.
- **Cooling mode visibility**: Cool setpoint field now conditionally shown based on whether the selected heat mode supports cooling (`hasCoolSetpoint`). Previously always shown when `hasCooling` was true.
- **New heater types**: Added `utheat`, `meheat`, `eti250heat`, and `utcool` to the heater state display logic.
- **Vacation mode control via WebSocket**: When connected via OCP WebSocket, vacation mode settings (enabled, date range) are fully editable with a save button. RS-485 connections retain read-only behavior with a warning.
- **Manual Heat checkbox**: Added "Manual Heat" option to IntelliCenter general configuration.
- **Pump min/max overrides**: Pump circuit speed/flow spinners now use per-pump overrides (`pump.minSpeed`, `pump.maxSpeed`, `pump.minFlow`, `pump.maxFlow`) when available, falling back to type defaults.
- **Schedule time controls**: Sunrise/sunset multiplier and offset fields now restricted to Nixie controllers only (hidden for IntelliCenter/IntelliTouch).
- **Firmware version parsing**: Dashboard now extracts numeric firmware version (e.g., "3.004" from "v3.004-build123") for cleaner display and comparison.
- **Config tab selection fix**: Fixed tab persistence when navigating between config sub-pages (circuits, bodies, schedules, controller).

### Bug Fixes
- **Swapped req/res in HTTPS redirect**: Fixed parameter order in the HTTPS redirect route handler (was silently broken since original implementation).
- **Priming speed display**: Fixed priming speed spinner only showing when both `maxPrimingTime` and `minSpeed`/`maxSpeed` are defined (avoids showing spinner for flow-only pumps that don't have priming speed).
- **url.parse deprecation**: Replaced deprecated `url.parse()` with `new URL()` in relay proxy.

### Dependency Upgrades
| Package | From | To |
|---------|------|-----|
| express | 4.21 | 5.2 |
| @types/express | 4.17 | 5.0 |
| typescript | 4.9 | 5.9 |
| @types/node | 20.x | 22.x |
| jquery | 3.7 | 4.0 |
| @fortawesome/fontawesome-free | 6.7 | 7.3 |
| multer | 2.0 | 2.2 |
| winston | 3.17 | 3.19 |

## [9.1.0] - 2026-06-01

### Features
- Pool covers panel with real-time socket updates
- Freeze protection status indicators
- Vacation mode scheduling UI
- Dynamic alert configuration UI with category rendering
- IntelliCenter role-based access control and PIN login (security)
- Covers/remotes config tabs
- Jandy heater protocol support
- JXi/LXi heater address picker
- Virtual equipment tabbed UI with chlorinator tab
- Pump configuration enhancements

### Bug Fixes
- Strip port from IP when building service URL (#110)
- Message Manager clear messages flow improvements

## [9.0.0] - 2026-03-15

### Features
- Virtual equipment configuration and functionality
- Valve dashboard integration
- AquaLink and WaterColors UI enhancements
- Neptune Modbus pump support
- QA smoke test scripts
- Firmware-aware dashboard and chemistry configuration
- Entity Flow Analyzer for protocol debugging
- Message documentation refactoring
- Body control support in entity flow

## [8.5.1] - 2025-12-20

### Bug Fixes
- AquaLink and WaterColors UI fixes
- Century pump light fix (PR #108)
- Remove regalmodbus2 reference

## [8.5.0] - 2025-11-15

### Features
- Entity flow features with body control support
- Message documentation enhancements
- CSS layering fixes for message manager
