/**
 * Tests for the AquaButler audit CSV exporter.
 *
 * Per kanban t_3790f4b4 (Bryan's 3rd branding answer), every audit row
 * is prefixed with the literal brand line `AquaButler Automation` (no
 * year, no parent brand, no URL). The attachment filename follows the
 * canonical-messages.md pattern:
 *   aquabutler-automation-<customer_id>-<YYYY-MM-DD>.csv
 *
 * Validates:
 *   - header includes the leading `brand` column
 *   - every data row starts with the literal brand line
 *   - filename embeds the active customer id and a UTC date
 *   - filename falls back to `all` when no active customer
 *   - the rendering still quotes/escapes per RFC 4180-ish rules
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAuditCsv, auditCsvFilename } from "../api";
import type { RetainedAuditEntry } from "../auditLog";

function mkEntry(overrides: Partial<RetainedAuditEntry> = {}): RetainedAuditEntry {
  return {
    ts: "2026-10-19T12:34:56.000Z",
    action: "pump_on",
    stream: "dashpanel_action",
    topic: "pool/cust-1/audit/dashpanel_action",
    source: "dashpanel",
    user_id: null,
    outcome: "executed",
    error: null,
    params: { state: "on" },
    ...overrides,
  };
}

test("audit CSV header includes the leading brand column", () => {
  const csv = renderAuditCsv([]);
  const header = csv.split("\n")[0];
  assert.equal(
    header,
    "brand,ts,action,stream,source,user_id,outcome,error,params",
  );
});

test("every audit row is prefixed with the AquaButler Automation brand line", () => {
  const entries = [
    mkEntry({ action: "pump_on" }),
    mkEntry({ action: "pump_off", params: { state: "off" } }),
    mkEntry({ action: "service_enter", outcome: "executed" }),
  ];
  const csv = renderAuditCsv(entries);
  const dataLines = csv.split("\n").slice(1).filter(Boolean);
  assert.equal(dataLines.length, 3);
  for (const line of dataLines) {
    assert.ok(
      line.startsWith("AquaButler Automation,"),
      `row should start with brand line, got: ${line}`,
    );
    // First column should be the bare brand line (no quoting needed —
    // there are no commas or quotes in the brand string itself).
    const first = line.split(",")[0];
    assert.equal(first, "AquaButler Automation");
  }
});

test("audit CSV escapes values that contain separators or quotes", () => {
  const entries = [
    mkEntry({
      action: "chlorination_override",
      params: { note: 'has,comma and "quote"' },
      error: 'failed: "broker disconnected"',
    }),
  ];
  const csv = renderAuditCsv(entries);
  // Brand column is the bare AquaButler Automation literal — no
  // quoting because the string contains no commas/quotes/newlines.
  assert.ok(
    csv.includes("AquaButler Automation,"),
    `csv should begin each row with the brand line, got: ${csv}`,
  );
  // The error cell should be quoted (contains both a comma and a quote).
  // Inner quotes are doubled per RFC 4180-ish rules.
  assert.ok(
    csv.includes('"failed: ""broker disconnected"""'),
    `error cell should be RFC-4180-escaped, got: ${csv}`,
  );
  // The params JSON cell is also quoted and contains the JSON-escaped
  // quote sequence (`\"` in JSON, which renders as `"` in the CSV with
  // an embedded escape). Just check that the literal word `quote` and
  // the surrounding doubled-quote characters appear.
  assert.ok(csv.includes("quote"), `params cell should include the word 'quote', got: ${csv}`);
  assert.ok(
    /"{2}[^"]*quote[^"]*"{2}/.test(csv) || /"{2}quote"{2}/.test(csv),
    `params cell should be wrapped in doubled quotes around 'quote', got: ${csv}`,
  );
});

test("audit CSV filename embeds the active customer id and a UTC date", () => {
  const name = auditCsvFilename("cust-1");
  assert.ok(name.startsWith("aquabutler-automation-cust-1-"), name);
  assert.match(name, /aquabutler-automation-cust-1-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("audit CSV filename falls back to 'all' when no active customer", () => {
  const name = auditCsvFilename(null);
  assert.match(name, /^aquabutler-automation-all-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("audit CSV filename sanitizes unsafe characters in the customer id", () => {
  const name = auditCsvFilename("cust/with spaces?and*chars");
  // Slashes / spaces / ? / * all map to underscores; the basename stays
  // a single token so the Content-Disposition header is well-formed.
  assert.ok(
    name.startsWith("aquabutler-automation-cust_with_spaces_and_chars-"),
    name,
  );
  assert.ok(!name.includes("/"), "filename must not contain raw slashes");
  assert.ok(!name.includes(" "), "filename must not contain spaces");
});

test("AquaButler locked brand palette is used in the customer switcher stylesheet", async () => {
  // Verifies the AquaButler widgets.css declares the navy header background
  // for the customer-switcher brand chip, the alert pill color, and the
  // offline banner — the three most-visible color usages shipped in
  // Layer 3 (per kanban t_3790f4b4 acceptance criteria).
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cssPath = path.join(
    process.cwd(),
    "themes/aquabutler/widgets.css",
  );
  const css = await fs.readFile(cssPath, "utf8");

  // Navy brand chip background
  assert.ok(
    css.includes("background: #0050b3") || css.includes("background-color: #0050b3"),
    `widgets.css should declare the navy #0050b3 brand color, got: ${css.slice(0, 400)}`,
  );

  // Alert pill color matches canonical-messages.md alert red
  assert.ok(
    css.includes("#dc2626"),
    `widgets.css should declare the alert red #dc2626 for the offline banner / bad pill`,
  );

  // AquaButler Automation sub-brand label is styled distinctly from AquaButler
  assert.ok(
    css.includes(".aqb-brand-sub"),
    "widgets.css should style the .aqb-brand-sub subtitle as a smaller, lighter label",
  );
});