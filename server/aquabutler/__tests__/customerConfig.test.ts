/**
 * Tests for the customer config loader.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadAquaButlerConfig,
  validateCustomers,
  resolvePasswordRef,
  AquaButlerConfig,
} from "../customerConfig";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aquabutler-test-"));
}

function writeConfig(dir: string, block: object | null): string {
  const cfg = block === null ? {} : { aquabutler: block };
  const p = path.join(dir, "defaultConfig.json");
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

test("returns EMPTY config when no aquabutler block in defaultConfig.json", () => {
  const dir = makeTmpDir();
  writeConfig(dir, null);
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const cfg: AquaButlerConfig = loadAquaButlerConfig(dir);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.customers.length, 0);
    assert.equal(cfg.activeCustomerId, null);
  } finally {
    process.chdir(originalCwd);
  }
});

test("enabled=true parses from defaultConfig.json", () => {
  const dir = makeTmpDir();
  writeConfig(dir, { enabled: true, customers: [] });
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const cfg = loadAquaButlerConfig(dir);
    assert.equal(cfg.enabled, true);
  } finally {
    process.chdir(originalCwd);
  }
});

test("enabled is overridden by POOL_AQUABUTLER_ENABLED=true even when file disabled", () => {
  const dir = makeTmpDir();
  writeConfig(dir, { enabled: false });
  process.env.POOL_AQUABUTLER_ENABLED = "true";
  try {
    const cfg = loadAquaButlerConfig(dir);
    assert.equal(cfg.enabled, true);
  } finally {
    delete process.env.POOL_AQUABUTLER_ENABLED;
  }
});

test("validates customer id format", () => {
  assert.throws(
    () => validateCustomers([
      { id: "short", displayName: "x", username: "customer_short", passwordRef: "env:F", permissionScope: "tech" },
    ]),
    /malformed/,
  );
});

test("rejects duplicate customer ids", () => {
  assert.throws(
    () => validateCustomers([
      { id: "abc-1234", displayName: "x", username: "customer_abc-1234", passwordRef: "env:F", permissionScope: "tech" },
      { id: "abc-1234", displayName: "y", username: "customer_abc-1234", passwordRef: "env:G", permissionScope: "readonly" },
    ]),
    /Duplicate/,
  );
});

test("requires the customer_<id> username prefix (per schema ACL)", () => {
  assert.throws(
    () => validateCustomers([
      { id: "abc-1234", displayName: "x", username: "wrong", passwordRef: "env:F", permissionScope: "tech" },
    ]),
    /customer_/,
  );
});

test("rejects unsupported passwordRef schemes (plaintext, vault, etc.)", () => {
  const dir = makeTmpDir();
  writeConfig(dir, {
    enabled: true,
    customers: [
      { id: "abc-1234", displayName: "x", username: "customer_abc-1234", passwordRef: "plaintext:foo", permissionScope: "tech" },
    ],
  });
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    assert.throws(() => loadAquaButlerConfig(dir), /passwordRef/);
  } finally {
    process.chdir(originalCwd);
  }
});

test("resolvePasswordRef: env:FOO resolves from process.env", () => {
  process.env.MY_TEST_PW = "abc123";
  try {
    assert.equal(resolvePasswordRef("env:MY_TEST_PW"), "abc123");
  } finally {
    delete process.env.MY_TEST_PW;
  }
});

test("resolvePasswordRef: returns undefined for unset env vars (fail-closed)", () => {
  assert.equal(resolvePasswordRef("env:NEVER_SET_XYZ"), undefined);
});

test("resolvePasswordRef: throws on non-env schemes", () => {
  assert.throws(() => resolvePasswordRef("plaintext:foo"), /Unsupported/);
});
