/**
 * Logger wrapper that no-ops when the singleton is uninitialized.
 *
 * Why this exists:
 *   - `server/logger/Logger.ts` exports a singleton `logger` whose
 *     underlying `_logger` is undefined until `logger.init()` runs.
 *   - `logger.init()` is called from `app.ts -> initAsync()`, so the
 *     production path is always OK.
 *   - But unit tests that bypass `app.ts` (which is most of them) get
 *     an uninitialized logger, and any call like `logger.info(...)`
 *     crashes with `Cannot read properties of undefined (reading 'info')`.
 *   - We never want a unit test to fail because of a logging issue, so
 *     production code uses this wrapper. The wrapper checks
 *     `_logger` exists before forwarding.
 *
 * Performance note: every call pays one extra property read; this is
 * fine for our domain (low logging rate per MQTT message).
 */
import { logger as rawLogger } from "../logger/Logger";

type Level = "info" | "warn" | "error" | "debug" | "verbose" | "silly";

const wrap = (level: Level) =>
  (...args: any[]): any => {
    const l: any = (rawLogger as any)._logger;
    if (l && typeof l[level] === "function") {
      return l[level].apply(l, args);
    }
  };

export const logger = {
  info: wrap("info"),
  warn: wrap("warn"),
  error: wrap("error"),
  debug: wrap("debug"),
  verbose: wrap("verbose"),
  silly: wrap("silly"),
};
