/**
 * In-memory pool state for the active customer.
 *
 * The MVP is simple — key-by-topic last-value-wins store. Layer 2
 * widgets will read from this; Layer 2 audit log will skip it (it
 * uses a separate per-topic accumulator because we want a list of
 * events, not "last value").
 *
 * Topic names come in fully-qualified (`pool/<id>/telemetry/ph`).
 * We strip the prefix and surface the rest as a flat object. The
 * shape is per the schema v1.0 read side:
 *
 *   { telemetry: { ph, orp_mV, pump_state, ... },
 *     status: { mode, last_error, ... },
 *     health: { system, comm, thermal },
 *     display: { state: { page, content_hash, rendered_at } },
 *     service: { mode, entered_at, expires_at, ... } }
 *
 * The UI polls `/aquabutler/state` on the active customer and
 * receives the same shape back.
 */
import { EventEmitter } from "events";
import { logger } from "./loggerSafe";

export interface PoolState {
  [group: string]: { [leaf: string]: unknown };
}

export class PoolStateStore extends EventEmitter {
  private _state: PoolState = {};
  private _customerId: string | null = null;

  constructor() {
    super();
    this._reset();
  }

  /**
   * Bind to the active customer's namespace. All `applyMessage` calls
   * are matched against `poolPrefix(customerId)/<group>/<leaf>` and
   * out-of-prefix messages are silently dropped (defense in depth —
   * the per-customer client should never deliver them, but if a future
   * broker-side cross-customer fanout gets enabled this is the trip
   * wire).
   */
  public setActiveCustomer(customerId: string | null): void {
    this._customerId = customerId;
    this._reset();
    this.emit("reset", customerId);
  }

  public get current(): PoolState {
    // Return a deep-copied snapshot so callers can't mutate us.
    return JSON.parse(JSON.stringify(this._state));
  }

  public get activeCustomerId(): string | null {
    return this._customerId;
  }

  /**
   * Update state from a fully-qualified MQTT message. Returns true if
   * the message was applied (matches our active customer), false if
   * dropped (different customer or malformed topic).
   */
  public applyMessage(topic: string, payload: unknown): boolean {
    if (!this._customerId) return false;
    const expected = `pool/${this._customerId}/`;
    if (!topic.startsWith(expected)) return false;
    const rest = topic.slice(expected.length);
    const parsed = parseTopicRest(rest);
    if (!parsed) return false;
    this._setAt(parsed.group, parsed.leaf, payload);
    this.emit("changed", { group: parsed.group, leaf: parsed.leaf, payload });
    return true;
  }

  private _reset(): void {
    // Mirror the canonical 9 read-side groups from
    // ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md v1.0 so
    // every applyMessage() finds a destination group, even before
    // Layer 2 widgets subscribe to the chem/dosing/config streams.
    // (Layer 1 only emits state from the 5 visible groups in the UI
    // today; pre-initialising the rest means Layer 2's "chem panel"
    // and "config view" work on the same store without a schema
    // rewrite when they land.)
    this._state = {
      telemetry: {},
      status: {},
      chem: {},
      dosing: {},
      health: {},
      config: {},
      display: {},
      service: {},
      audit: {},
    };
  }

  private _setAt(group: string, leaf: string, payload: unknown): void {
    if (!(group in this._state)) {
      logger.warn(`PoolState: unknown group '${group}' from topic`);
      return;
    }
    // Schema v1.0 wraps the payload envelope as `{value, last_changed}`.
    // Unwrap so the UI gets `telemetry.ph = 7.4`, not `telemetry.ph = {value:7.4,...}`.
    const unwrapped = unwrapEnvelope(payload);
    this._state[group][leaf] = unwrapped;
  }
}

/** Parse `telemetry/ph` -> {group:'telemetry', leaf:'ph'}.
 *  For `display/state` -> {group:'display', leaf:'state'}.
 *  For `health/thermal` -> {group:'health', leaf:'thermal'}.
 *  Falls back to `<group>/<subgroup>/<leaf>` for vendor-specific leaves.
 */
function parseTopicRest(
  rest: string,
): { group: string; leaf: string } | null {
  const parts = rest.split("/");
  if (parts.length === 2) {
    return { group: parts[0], leaf: parts[1] };
  }
  return null;
}

function unwrapEnvelope(payload: unknown): unknown {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "value" in (payload as Record<string, unknown>)
  ) {
    return (payload as Record<string, unknown>).value;
  }
  return payload;
}
