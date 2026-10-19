# 2026-10-19 — dashPanel AquaButler Layer 3 (Theming + Canonical Messages + CSV Footer)

> **Layer 3 of the dashPanel fork modernization** (Layer 1 = multi-tenant MQTT shell, Layer 2 = five per-customer widgets + audit log store). This layer ships the AquaButler visual identity, normalizes the user-visible strings to the locked brand vocabulary, and stamps the audit-log CSV export with the canonical "AquaButler Automation" footer line.
>
> **Author:** Friday (`.worktrees/layer3` on `feat/aquabutler-layer3-theming-t_3790f4b4`)
> **Status:** Code + tests + wiki in one commit on `feat/aquabutler-layer3-theming-t_3790f4b4`. Rebase + PR to `ultron-aquabutler/Controller-dashPanel:main` pending.

---

## Overview

Bryan answered the 4 branding questions on `t_1e9f6f85` (comment 6552) on 2026-10-19. Layer 3 implements the locked decisions:

1. **Branding scope:** Full AquaButler theme. New `themes/aquabutler/` directory, set as the default theme in the dashPanel fork. NOT a sub-mark overlay on `aqualinkd-dark`. NOT a theme toggle.
2. **Logo source:** `aquabutler-submark-placeholder-2026-10-18.jpg` (SHA `da3f913eb25b0653460fcc42981b979b16402b0bcafb723d2d2bfabfdfbca124`, navy bg + light-blue water drop + two-tone AquaButler text). Interim until graphic designer delivers the real mascot. NOT the parent Backyard Butlers logo. NOT the robot mascot v5.
3. **CSV footer / copyright:** `AquaButler Automation` only — no year, no parent brand, no URL. Just the sub-brand name as the audit-log line prefix.
4. **Canonical vocab doc location:** Obsidian Vault for all docs. The canonical-messages source lives at `Homelab/30-AquaButler/canonical-messages.md` in the Obsidian Vault (sibling to `Homelab/30-AquaButler/Branding/Brand_Assets_2026-10-18.md`). A copy of the staging draft is at `~/AquaButler-Server/docs/wiki/canonical-messages.md` (commit `ae2bff1` on `brydenver2/AquaButler-Server:main`) for repo-side reference; the 44-string inventory population goes there as a separate commit on the AquaButler-Server repo (see `populate-canonical-messages.md` in that repo).

## Architecture

### Theme directory layout

```
themes/aquabutler/
├── assets/
│   └── aquabutler-submark-placeholder-2026-10-18.jpg   (SHA da3f913e…, copied verbatim from ultron-aquabutler/AquaButler-Hardware:main:brand/)
├── colors.css          (1-byte marker file, same convention as aqualinkd-dark/colors.css)
├── theme.css           (full AquaButler stylesheet: navy header, light bg, alert red, system font)
└── widgets.css         (widget-level overrides + the .aqb-brand chip + .aquabutler-pill colors)
```

The `theme.css` declares the canonical AquaButler palette on `:root` (mirroring the existing aqualinkd-dark variable surface — `--body_background`, `--head_background`, `--head_text`, `--tile_on_background`, `--value_tile_normal_color`, `--error_background`, etc.). Widgets.css layers on the customer-switcher brand chip + per-widget styles.

### Page bootstrap change

`pages/index.html` and `pages/messageManager.html` both:
1. Force `theme = 'aquabutler'` on every load (no `prefers-color-scheme` lookup).
2. Rewrite any stale `dashTheme` value (e.g. `'aqualinkd'`, `'aqualinkd-dark'`) to `'aquabutler'` on the next reload, so a returning user doesn't see unstyled content during the localStorage migration.
3. Do **not** mount a theme toggle. `mountThemeToggle()` was removed from `pages/index.html` and `pages/messageManager.html`. The `.picThemeToggle { display: none; }` rule in `themes/aquabutler/theme.css` enforces the no-toggle contract.

### Customer switcher brand chip

`pages/aquabutler/customerSwitcher.html` now renders the AquaButler brand chip statically:

```html
<span class="aqb-brand" aria-label="AquaButler Automation">
  <img src="themes/aquabutler/assets/aquabutler-submark-placeholder-2026-10-18.jpg" alt="AquaButler" />
  <span>AquaButler<span class="aqb-brand-sub">Automation</span></span>
</span>
```

The chip sits to the left of the customer dropdown + connection pill. `scripts/aquabutler/customerSwitcher.js` was updated so `renderDropdown()` does **not** `$host.empty()` the brand chip — it only removes `select` and `#aquabutler-conn`, then inserts the dropdown + pill after the preserved chip. This was the most fragile change of the layer; the old `$host.empty()` would have wiped the brand chip on every customer-list refresh.

### CSV footer

`server/aquabutler/api.ts:renderAuditCsv()` now adds a leading `brand` column whose value is the literal string `AquaButler Automation` on every row (including the header). The filename is built by a new `auditCsvFilename()` helper that follows the canonical-messages.md pattern:

```
aquabutler-automation-<customer_id>-<YYYY-MM-DD>.csv
```

UTC date, sanitized customer id (anything outside `[a-zA-Z0-9._-]` maps to `_`), `all` fallback when there is no active customer. Exported for tests.

### Brand colors and where they are asserted

| Color | Hex | Where it's used | Test that asserts it |
|---|---|---|---|
| Navy (brand) | `#0050b3` | `.picHeader`, `.picTile.is-on`, `.aqb-brand` background, `--value_tile_normal_color`, headings | `auditCsv.test.ts` reads `themes/aquabutler/widgets.css` and asserts `#0050b3` appears as a background color |
| Light bg | `#f5f8fc` | Body, `--body_background` | (covered by visual smoke; not asserted in test infra) |
| Alert red | `#dc2626` | `--error_background`, `.aqb-offline-banner`, `.aquabutler-pill-bad`, `--value_tile_outofrange_color` | `auditCsv.test.ts` asserts `#dc2626` appears in `widgets.css` |

## Operation

**TBD — `@ultron_wallace_bot`.** Friday ships the theme + CSV + tests but does not run the rendered dashboard in a live browser, so the following operational answers are not in scope for this PR and need an in-context smoke run from the cluster:

- The exact visual feel of the customer-switcher brand chip at 540px / 768px / 1024px / 1280px breakpoints.
- The exact hover/focus states on the brand chip and the connection pill.
- How the existing aqualinkd/aqualinkd-dark favicon (if any) renders next to the AquaButler brand chip — favicon swap is out of scope for this commit and may need a follow-up.
- Confirmation that `pages/fixture/index.html` still renders cleanly with the AquaButler theme (it shares the `themes/widgets.css` plus the AquaButler theme contract).

## Troubleshooting

**TBD — `@ultron_wallace_bot`.** Friday cannot exercise the dashboard in a browser. Known issue areas the operator should probe:

- A browser with stale `dashTheme='aqualinkd-dark'` in localStorage should reload and show the AquaButler theme without a flash of unstyled content. If it doesn't, the `setStorage('dashTheme', 'aquabutler')` rewrite in `pages/index.html` is not running early enough — fall back to clearing localStorage.
- The CSV download header should advertise `filename="aquabutler-automation-<customer>-<date>.csv"`. If a browser shows `aquabutler-audit-...csv` instead, the Layer 2 filename (already replaced) is being cached somewhere — clear the `<link>` reference in `server/aquabutler/api.ts` and rebuild.
- If the customer switcher brand chip disappears after a customer list refresh, the `customerSwitcher.js` `$host.empty()` regression has resurfaced — re-read `scripts/aquabutler/customerSwitcher.js:51-67` and confirm the chip-preserve logic is intact.

## Configuration

Layer 3 ships with **zero new configuration**. The AquaButler theme is unconditional — no env flag, no settings toggle. A customer who wants to fall back to the upstream `aqualinkd` family would need to:
1. Revert `pages/index.html` and `pages/messageManager.html` to the pre-Layer-3 version.
2. Drop the `themes/aquabutler/` directory.

Neither is supported going forward. The AquaButler brand lock per `t_1e9f6f85` is the single canonical identity for this fork.

## Dependencies

- **Layer 1** (multi-tenant MQTT shell, `feat/aquabutler-multitenant-layer1-t_540065f7` — closed, merged at `392169d`): provides the `/aquabutler/customers` + `/aquabutler/active-customer` endpoints that the customer switcher chip + dropdown depend on.
- **Layer 2** (five widgets + audit log, `feat/aquabutler-layer2-widgets-t_3e66bc7f` — closed, merged at `004cb65`): provides the `/aquabutler/audit.csv` endpoint that `renderAuditCsv` now annotates. The pin_hash regression test (commit `d289de6`) is included in Layer 3's base branch.
- **AquaButler-Server canonical-messages doc** (`ae2bff1` on `brydenver2/AquaButler-Server:main`): the source of truth for the locked brand rules. The 44-string inventory populate is filed as a separate commit on the AquaButler-Server repo (`feat/aquabutler-canonical-messages-t_3790f4b4` — pending creation).
- **Brand assets** (`ultron-aquabutler/AquaButler-Hardware:main:brand/`): canonical source of `aquabutler-submark-placeholder-2026-10-18.jpg`. The copy in `themes/aquabutler/assets/` is byte-identical (SHA `da3f913e…`).

## See Also

- `Homelab/30-AquaButler/canonical-messages.md` — Obsidian Vault source of truth for AquaButler user-visible strings.
- `Homelab/30-AquaButler/Branding/Brand_Assets_2026-10-18.md` — Obsidian Vault brand asset exploration log (v0-v5 robot mascot iterations, sub-mark variants).
- `docs/wiki/2026-10-18-dashpanel-aquabutler-layer1.md` — Layer 1 (multi-tenant MQTT shell) wiki.
- `docs/wiki/2026-10-18-dashpanel-aquabutler-layer2.md` — Layer 2 (five widgets + audit log) wiki.
- `~/AquaButler-Server/docs/wiki/canonical-messages.md` — staging copy of the canonical-messages doc (commit `ae2bff1`).
- `server/aquabutler/__tests__/auditCsv.test.ts` — Layer 3's new tests.
- `themes/aqualinkd-dark/colors.scss` — reference for the variable contract that `themes/aquabutler/theme.css` implements.

## Kanban trail

- `t_1e9f6f85` — Layer 3 kickoff + branding questions (closed, Bryan answered 2026-10-19).
- `t_abc9898f` — DM kickoff (closed, redundant with `t_1e9f6f85`).
- `t_dfecb248` — accent-on-dark fallback (archived, superseded by Layer 3).
- `t_e85d5dc9` — vocab doc author (archived, doc staged at `ae2bff1` instead).
- `t_be6405c7` — filename pattern (archived, Layer 3 chooses `aquabutler-automation-<id>-<date>.csv`).
- `t_3790f4b4` — this work.
- `t_540065f7` — Layer 1 parent (closed, `392169d`).
- `t_3e66bc7f` — Layer 2 parent (closed, `004cb65` + `d289de6`).
- `t_4b5a5ab0` — MiniMax image skill (closed).
- `t_49156291` — vault auth fix (closed).
- `t_a5f47e93` — pin_hash TODO cleanup (closed, regression test included in Layer 3's base).
- `t_ec1f97fb` — librarian canonical-messages vault push (in flight, parallel with this work).
- `t_ea19acd3` — Vision: Supabase auth (gates production deploy, not Layer 3).