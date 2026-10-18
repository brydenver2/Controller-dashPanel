/**
 * Tests for the auth middleware stub.
 *
 * Validates:
 *   - 401 returned when enabled and no bypass header
 *   - 401 carries the `auth-not-wired` error code so the UI can render
 *     a clear "strategy not yet wired" message
 *   - bypass header short-circuits the middleware
 *   - when disabled, the middleware passes through silently
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as http from "http";
import { AddressInfo } from "net";
import { buildAuthMiddleware } from "../authMiddleware";
import { AquaButlerConfig } from "../customerConfig";

const cfg: AquaButlerConfig = {
  enabled: true,
  broker: { url: "mqtt://test:1883", clientIdPrefix: "test" },
  customers: [],
  activeCustomerId: null,
};

const cfgDisabled = { ...cfg, enabled: false };

async function makeServer(
  cfgArg: AquaButlerConfig,
  inTestMode = false,
): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(buildAuthMiddleware(cfgArg, inTestMode));
  app.get("/probe", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function fetchStatus(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(baseUrl + "/probe", { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: any = text;
        try { body = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on("error", reject);
  });
}

test("returns 401 with auth-not-wired when enabled and no bypass", async () => {
  const { server, baseUrl } = await makeServer(cfg);
  try {
    const r = await fetchStatus(baseUrl);
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "auth-not-wired");
  } finally {
    server.close();
  }
});

test("bypass header short-circuits the middleware", async () => {
  const { server, baseUrl } = await makeServer(cfg);
  try {
    const r = await fetchStatus(baseUrl, { "X-AquaButler-Bypass": "1" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  } finally {
    server.close();
  }
});

test("disabled config: pass-through, no bypass needed", async () => {
  const { server, baseUrl } = await makeServer(cfgDisabled);
  try {
    const r = await fetchStatus(baseUrl);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  } finally {
    server.close();
  }
});

test("inTestMode bypasses auth even without an X-AquaButler-Bypass header", async () => {
  const { server, baseUrl } = await makeServer(cfg, true);
  try {
    const r = await fetchStatus(baseUrl);
    assert.equal(r.status, 200);
  } finally {
    server.close();
  }
});

test("inTestMode auth-required header re-enables the gate", async () => {
  const { server, baseUrl } = await makeServer(cfg, true);
  try {
    const r = await fetchStatus(baseUrl, { "X-AquaButler-Require-Auth": "1" });
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});
