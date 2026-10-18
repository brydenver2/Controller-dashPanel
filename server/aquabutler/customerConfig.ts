/**
 * AquaButler customer config loader.
 *
 * Reads the `aquabutler.customers` block from the existing config tree
 * (defaultConfig.json + config.json overlay, same merge path Config.ts
 * already uses). The list is the single source of truth for which
 * customers this dashPanel knows about — credentials are issued by
 * the cluster at commissioning and stored here (never in plaintext on
 * the wire; see the schema doc ACL spec).
 *
 * Schema in defaultConfig.json (additive — do not break upstream):
 *
 *   "aquabutler": {
 *     "enabled": false,
 *     "broker": {
 *       "url": "mqtts://mqtt.aquabutlers.com:8883",
 *       "clientIdPrefix": "dashpanel"
 *     },
 *     "customers": [
 *       {
 *         "id": "uuid-v4",
 *         "displayName": "Goldin Residence",
 *         "username": "customer_<id>",
 *         "passwordRef": "env:AQUABUTLER_CUST_<ID>_PASSWORD",
 *         "permissionScope": "tech"
 *       }
 *     ]
 *   }
 *
 * Env-var override pattern (consistent with Config.ts POOL_WEB_* style):
 *   POOL_AQUABUTLER_ENABLED=true
 *   POOL_AQUABUTLER_BROKER_URL=mqtts://...
 *   POOL_AQUABUTLER_<CUSTOMER>_PASSWORD=... (per-customer, never logged)
 */
import * as fs from "fs";
import * as path from "path";

export interface AquaButlerBrokerConfig {
  url: string;
  clientIdPrefix: string;
  /** Optional CA bundle for self-hosted broker dev.  */
  caPath?: string;
}

export interface AquaButlerCustomerConfig {
  id: string;
  displayName: string;
  /** MQTT username — see schema doc §Per-customer ACL. */
  username: string;
  /**
   * Reference to where the password lives. NEVER log the resolved value.
   * Today only "env:<var>" is supported; future revisions may add
   * `vault:infisical:...` once the secrets strategy lands (see
   * t_ea19acd3 vision:auth follow-up).
   */
  passwordRef: string;
  /**
   * Permission scope: "tech" (full read+write per the spec) or
   * "readonly" (read-only, can also be enforced at the broker by ACL).
   * Reserved for Layer 2 widgets; not used yet in Layer 1.
   */
  permissionScope: "tech" | "readonly";
}

export interface AquaButlerConfig {
  enabled: boolean;
  broker: AquaButlerBrokerConfig;
  customers: AquaButlerCustomerConfig[];
  /**
   * Active customer_id at boot.  Layer 1 UI lets techs switch this at
   * runtime; the server falls back to this when the UI hasn't picked
   * one yet (e.g., the dashboard was just opened headless in CI).
   */
  activeCustomerId: string | null;
  /**
   * Test-only: skip creating real MQTT clients. When true, the fleet
   * still tracks active-customer state but does not open any
   * connections. Production code never sets this. Wired through
   * `mcpClientFactory` below — tests inject a mock factory.
   */
  skipMqttForTests?: boolean;
  /**
   * Test-only: a factory that returns an mqtt.MqttClient-compatible
   * object. Used by tests to avoid real network. Production code
   * calls `mqtt.connect(...)` directly.
   */
  mcpClientFactory?: (url: string, opts: any) => any;
}

const EMPTY: AquaButlerConfig = {
  enabled: false,
  broker: { url: "mqtts://localhost:8883", clientIdPrefix: "dashpanel" },
  customers: [],
  activeCustomerId: null,
};

/**
 * Resolve a `passwordRef` like "env:FOO_BAR" against the process env.
 * Returns undefined if the variable is unset; the caller MUST refuse to
 * connect rather than substitute an empty password (Mosquitto will fail
 * with a different error, but the principle stands — fail closed).
 */
export function resolvePasswordRef(ref: string): string | undefined {
  if (!ref.startsWith("env:")) {
    throw new Error(
      `Unsupported passwordRef scheme '${ref}'. Only env:<var> is supported in Layer 1 (no plaintext password storage).`,
    );
  }
  return process.env[ref.slice(4)];
}

/**
 * Validate the customers array. Throws on malformed entries — we want
 * fail-fast at boot, not silent runtime errors when the tech switches
 * to a half-configured customer.
 */
export function validateCustomers(
  customers: AquaButlerCustomerConfig[],
): void {
  const seenIds = new Set<string>();
  for (const c of customers) {
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(c.id)) {
      throw new Error(
        `Customer id '${c.id}' is malformed. Expected 8-64 chars of alphanumeric or dash.`,
      );
    }
    if (seenIds.has(c.id)) {
      throw new Error(`Duplicate customer id '${c.id}'.`);
    }
    seenIds.add(c.id);
    if (!c.username.startsWith("customer_")) {
      throw new Error(
        `Customer '${c.id}' username '${c.username}' must start with 'customer_' per schema ACL.`,
      );
    }
    if (c.permissionScope !== "tech" && c.permissionScope !== "readonly") {
      throw new Error(
        `Customer '${c.id}' permissionScope must be 'tech' or 'readonly'.`,
      );
    }
    if (!c.passwordRef.startsWith("env:")) {
      throw new Error(
        `Customer '${c.id}' passwordRef '${c.passwordRef}' must start with 'env:' in Layer 1. ` +
        `No plaintext password storage. (Future revisions may add 'vault:<provider>:<path>'.)`,
      );
    }
  }
}

/**
 * Loads the AquaButler config block, layered as:
 *   defaults <- file overlay <- env vars
 *
 * Per the upstream-friendly additive design, returns the EMPTY config if
 * the `aquabutler` block is missing entirely — that's how we avoid
 * breaking the single-tenant hobbyist use case.
 */
export function loadAquaButlerConfig(
  cwd: string = process.cwd(),
): AquaButlerConfig {
  const defaultPath = path.join(cwd, "defaultConfig.json");
  let fileCfg: Partial<AquaButlerConfig> = {};
  if (fs.existsSync(defaultPath)) {
    try {
      const raw = fs.readFileSync(defaultPath, "utf8");
      const parsed = JSON.parse(raw);
      fileCfg = parsed.aquabutler || {};
    } catch (e) {
      // Same swallow-and-fall-back behaviour the upstream config loader
      // uses in Config.ts.
    }
  }

  // Env-var override (mirrors POOL_WEB_* pattern).
  const env = process.env;
  const enabled =
    (typeof env.POOL_AQUABUTLER_ENABLED !== "undefined" &&
      ["true", "1", "yes", "on"].includes(
        env.POOL_AQUABUTLER_ENABLED.toLowerCase(),
      )) ||
    !!fileCfg.enabled;

  const brokerUrl =
    env.POOL_AQUABUTLER_BROKER_URL || fileCfg.broker?.url || EMPTY.broker.url;
  const clientIdPrefix =
    env.POOL_AQUABUTLER_BROKER_CLIENTID_PREFIX ||
    fileCfg.broker?.clientIdPrefix ||
    EMPTY.broker.clientIdPrefix;

  const customers: AquaButlerCustomerConfig[] = Array.isArray(fileCfg.customers)
    ? fileCfg.customers
    : [];

  if (customers.length > 0) {
    validateCustomers(customers);
  }

  return {
    enabled,
    broker: { url: brokerUrl, clientIdPrefix, caPath: fileCfg.broker?.caPath },
    customers,
    activeCustomerId:
      env.POOL_AQUABUTLER_ACTIVE_CUSTOMER_ID || fileCfg.activeCustomerId || null,
  };
}
