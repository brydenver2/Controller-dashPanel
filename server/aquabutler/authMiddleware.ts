/**
 * AquaButler auth middleware — STUB.
 *
 * This is the auth integration point per t_540065f7 Layer 1 item 4.
 * The card body names this Vision's lane: "Auth flow change
 * (Supabase auth vs local poolcontroller password): Vision's lane for
 * auth strategy approval."
 *
 * The implementation strategy lives in t_ea19acd3 (filed by Friday
 * alongside this work). Until that lands, this middleware:
 *   1. Passes through any request with `X-AquaButler-Bypass: 1` so
 *      local dev (and any tests) can run without a Supabase project.
 *   2. Allows anything when `aquabutler.enabled` is false.
 *   3. Otherwise returns 401 with a clear "auth strategy not yet wired"
 *      message — never silently allow. Never silently 500.
 *
 * No real auth code lives here yet. Adding it without Vision's call
 * would lock in a strategy that's then hard to swap; better to
 * consciously stub for one release cycle.
 */
import express from "express";
import { logger } from "./loggerSafe";
import { AquaButlerConfig } from "./customerConfig";

export interface AquaButlerAuthSubject {
  /** Supabase user UUID when auth is wired; null in stub mode. */
  userId: string | null;
  /** Display name for UI; future impl will pull from Supabase profile. */
  displayName: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    aquaButlerSubject?: AquaButlerAuthSubject;
  }
}

/**
 * Express middleware factory.
 * - `cfg` is the loaded AquaButler config (so we can early-return when disabled).
 * - `inTestMode` is true from the test suite — bypasses auth even
 *   when enabled. Tests should be hermetic; auth must never be the
 *   test's make-or-break.
 */
export function buildAuthMiddleware(
  cfg: AquaButlerConfig,
  inTestMode: boolean = false,
) {
  return function authMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    if (!cfg.enabled) {
      // AquaButler layer is off — pass through, no auth.
      return next();
    }
    const bypass = req.header("X-AquaButler-Bypass");
    if (bypass === "1" || (inTestMode && !req.header("X-AquaButler-Require-Auth"))) {
      req.aquaButlerSubject = { userId: null, displayName: "test-bypass" };
      return next();
    }
    // TODO(@vision_wallace_bot): wire Supabase auth flow here per t_ea19acd3.
    // Until then, return 401 with the reason visible in the UI so the
    // operator knows why the dashboard is grey.
    logger.warn(
      "AquaButler auth middleware hit but no strategy is wired; returning 401. See t_ea19acd3.",
    );
    res.status(401).json({
      error: "auth-not-wired",
      message:
        "AquaButler auth is not yet wired. See kanban card t_ea19acd3 (@vision_wallace_bot).",
    });
  };
}
