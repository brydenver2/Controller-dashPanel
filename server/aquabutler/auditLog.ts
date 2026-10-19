/**
 * Per-customer rolling audit log buffer (Layer 2).
 *
 * Why a separate buffer (not just `poolState.audit`):
 *   The poolState store is "last-value-wins" per topic leaf. We need
 *   a *list* of events to render the audit log widget and to
 *   generate the CSV export. Same in-memory-event-stream pattern
 *   the bridge uses, scoped to the dashPanel.
 *
 * Why in-memory (not Postgres):
 *   - The bridge already writes `audit` rows to Postgres with 7-year
 *     retention (per schema §Retention policy). The dashPanel buffer
 *     is a *live mirror* for the most-recent N entries — what the
 *     tech needs to see right now without waiting on the bridge.
 *   - If the dashPanel restarts, we rehydrate from the bridge. Not
 *     wired in Layer 2 (the bridge has its own connection / API key
 *     story that's not in scope here); instead we just show whatever
 *     arrives after boot and document the gap.
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §audit/<stream>
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §Write topics
 *   server/aquabutler/poolState.ts (sibling store; we do NOT depend
 *     on it for audit because we need ordered append, not last-value)
 */
import { EventEmitter } from "events";
import { logger } from "./loggerSafe";
import { AuditEnvelope } from "./mqttClient";

/**
 * Default buffer capacity per customer. 100 covers the widget's
 * "last 100 entries" UX (Layer 2 acceptance criterion) and the
 * canonical CSV export. Bigger buffers chew RAM on a per-customer
 * basis; bump via `new AuditLogStore({capacity: 1000})` if a future
 * consumer (audit search? fleet alerts?) needs more.
 */
export const DEFAULT_AUDIT_BUFFER_CAPACITY = 100;

export interface AuditLogStoreOptions {
  capacity?: number;
}

/**
 * One retained audit entry. Wraps the schema envelope plus the
 * source topic so the UI can render stream labels (manual / service
 * / dashpanel_action / etc.).
 */
export interface RetainedAuditEntry extends AuditEnvelope {
  /** Source topic suffix: "audit/manual", "audit/service", "audit/dashpanel_action". */
  stream: string;
  /** The full topic the message arrived on, including customer_id. */
  topic: string;
}

/**
 * Per-customer rolling audit log. We keep separate ring buffers for
 * each stream (manual, service, dashpanel_action, ...) so the widget
 * can scope queries; the buffer is shared across streams.
 *
 * Capacity is enforced per-stream; the total memory footprint is
 * O(capacity * distinct_streams). For the dashPanel's 3 streams
 * (manual + service from the rotary firmware + dashpanel_action
 * from this server) and capacity=100, that's 300 entries max.
 */
export class AuditLogStore extends EventEmitter {
  private readonly _capacity: number;
  private _buffers: Map<string, RetainedAuditEntry[]> = new Map();
  private _customerId: string | null = null;

  constructor(opts: AuditLogStoreOptions = {}) {
    super();
    this._capacity = opts.capacity || DEFAULT_AUDIT_BUFFER_CAPACITY;
  }

  /** Bind to the active customer; clears the in-memory buffers. */
  public setActiveCustomer(customerId: string | null): void {
    this._customerId = customerId;
    this._buffers.clear();
    this.emit("reset", customerId);
  }

  public get activeCustomerId(): string | null {
    return this._customerId;
  }

  /**
   * Append an inbound audit message. The message must be on a fully-
   * qualified `pool/<id>/audit/<stream>` topic; the customer scope is
   * the current active customer. Out-of-scope or malformed messages
   * are silently dropped (defense in depth — same as poolState).
   *
   * Returns true if the message was accepted, false otherwise.
   */
  public appendFromMessage(topic: string, payload: unknown): boolean {
    if (!this._customerId) return false;
    const expected = `pool/${this._customerId}/audit/`;
    if (!topic.startsWith(expected)) return false;
    const stream = topic.slice(expected.length);
    if (stream.length === 0) return false;

    // Validate the schema envelope; we don't want to retain garbage
    // that the CSV export would propagate.
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    if (
      typeof p.ts !== "string" ||
      typeof p.action !== "string" ||
      typeof p.params !== "object" ||
      p.params === null
    ) {
      logger.warn(
        `AuditLog: malformed audit envelope on ${topic}; skipping append.`,
      );
      return false;
    }
    const entry: RetainedAuditEntry = {
      ts: p.ts,
      action: p.action,
      params: p.params as Record<string, unknown>,
      source: (p.source as RetainedAuditEntry["source"]) || "dashpanel",
      user_id: (p.user_id as string | null) ?? null,
      outcome: (p.outcome as RetainedAuditEntry["outcome"]) || "executed",
      error: (p.error as string | null) ?? null,
      stream,
      topic,
    };

    let buf = this._buffers.get(stream);
    if (!buf) {
      buf = [];
      this._buffers.set(stream, buf);
    }
    buf.push(entry);
    if (buf.length > this._capacity) {
      buf.splice(0, buf.length - this._capacity);
    }
    this.emit("appended", entry);
    return true;
  }

  /**
   * Recent entries across all streams for the active customer, in
   * reverse-chronological order (newest first).
   *
   * `stream` (optional) scopes to a single audit stream
   * ("manual" | "service" | "dashpanel_action" | ...).
   * `limit` clamps the returned slice; default is the buffer's full
   * capacity. Pagination via offset is supported — useful for the
   * widget's "load more" button if/when that lands.
   */
  public recent(opts: {
    stream?: string;
    limit?: number;
    offset?: number;
  } = {}): RetainedAuditEntry[] {
    const stream = opts.stream;
    const limit = opts.limit ?? this._capacity;
    const offset = opts.offset ?? 0;

    const all = this._merged(stream);
    const sliced = all.slice(offset, offset + limit);
    return sliced;
  }

  /** Number of retained entries across all streams. */
  public size(): number {
    let n = 0;
    for (const buf of this._buffers.values()) n += buf.length;
    return n;
  }

  /**
   * Internal: merge one or all stream buffers into one reverse-
   * chronological list. Sort by `ts` (ISO8601 sorts lexically).
   * Used by `recent()` and by the CSV export endpoint.
   */
  private _merged(stream?: string): RetainedAuditEntry[] {
    const all: RetainedAuditEntry[] = [];
    if (stream !== undefined) {
      const buf = this._buffers.get(stream);
      if (buf) all.push(...buf);
    } else {
      for (const buf of this._buffers.values()) all.push(...buf);
    }
    all.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return all;
  }
}