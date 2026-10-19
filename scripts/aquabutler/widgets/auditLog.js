/* AquaButler rotary-display audit log widget (Layer 2, item 2).
 *
 * Renders the last 100 audit entries for the active customer and
 * keeps the list live via the `aquabutler:audit` socket event. CSV
 * export is a one-click download through /aquabutler/audit.csv.
 *
 * Cross-references:
 *   ~/AquaButler-Server/docs/wiki/mqtt-topic-schema.md §audit/<stream>
 *   server/aquabutler/auditLog.ts (server-side buffer)
 *   server/aquabutler/api.ts (REST endpoints)
 */
(function ($) {
  "use strict";

  const PAGE_SIZE = 100;

  function fmtTs(iso) {
    // Local-time, second-precision — the schema uses ISO8601 UTC.
    const d = new Date(iso);
    if (Number.isNaN(d.valueOf())) return iso;
    return d.toLocaleString();
  }

  function fmtParams(params) {
    if (!params || typeof params !== "object") return "—";
    return Object.entries(params)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" ");
  }

  function renderRow(entry, opts = {}) {
    const tr = $("<tr></tr>");
    tr.append($("<td></td>").text(fmtTs(entry.ts)));
    tr.append($("<td></td>").text(entry.action));
    tr.append($("<td class='aqb-audit-param-cell'></td>").text(fmtParams(entry.params)));
    tr.append($("<td></td>").text(entry.source || "—"));
    tr.append($("<td></td>").text(entry.user_id || "—"));
    const outcomeCell = $("<td></td>").text(entry.outcome || "executed");
    tr.append(outcomeCell);
    if (entry.outcome === "rejected_safety" || entry.outcome === "failed") {
      tr.addClass("aqb-row-rejected");
      if (entry.error) {
        outcomeCell.attr("title", entry.error);
      }
    }
    if (opts.flash) tr.addClass("aqb-row-new");
    return tr;
  }

  function bootstrap($host) {
    if (!window.AquaButlerBus) {
      $host.text("AquaButler bus not loaded.");
      return;
    }
    const bus = window.AquaButlerBus;
    bus.connect();

    const state = {
      entries: [],
      total: 0,
      offset: 0,
      stream: "",
    };

    function refresh() {
      bus
        .getAudit({ stream: state.stream || undefined, limit: PAGE_SIZE, offset: state.offset })
        .then((res) => {
          state.entries = res.entries || [];
          state.total = res.total || 0;
          $host.find(".aqb-audit-log-count").text(`${state.total} entries`);
          const $tbody = $host.find(".aqb-audit-log-table tbody").empty();
          for (const e of state.entries) {
            $tbody.append(renderRow(e));
          }
          const pageNum = Math.floor(state.offset / PAGE_SIZE) + 1;
          const maxPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
          $host.find(".aqb-audit-page-info").text(`Page ${pageNum} of ${maxPages}`);
          $host.find(".aqb-audit-prev").prop("disabled", state.offset === 0);
          $host.find(".aqb-audit-next").prop(
            "disabled",
            state.offset + PAGE_SIZE >= state.total,
          );
        })
        .catch((err) => {
          $host.find(".aqb-audit-log-table tbody").html(
            `<tr><td colspan="6" style="color:#c62828">Audit unavailable: ${err.message}</td></tr>`,
          );
        });
    }

    // Initial paint
    refresh();

    // Live append: prepend the new entry without re-fetching.
    bus.onAudit((evt) => {
      // If the entry matches our current stream filter, prepend.
      if (state.stream && evt.topic && !evt.topic.endsWith(`/audit/${state.stream}`)) {
        return;
      }
      const entry = Object.assign({}, evt.payload || {}, {
        stream: (evt.topic || "").split("/").pop() || "",
        topic: evt.topic,
      });
      // Refresh from server (simpler than deduping locally).
      refresh();
      // Briefly flash the top row.
      setTimeout(() => {
        const $first = $host.find(".aqb-audit-log-table tbody tr:first");
        if ($first.length > 0) {
          $first.addClass("aqb-row-new");
          setTimeout(() => $first.removeClass("aqb-row-new"), 1500);
        }
      }, 100);
    });

    // When active customer changes, the server resets the buffer —
    // refresh and reset pagination.
    bus.onState((snap) => {
      state.offset = 0;
      refresh();
    });

    $host.on("change", ".aqb-audit-stream", function () {
      state.stream = $(this).val();
      state.offset = 0;
      refresh();
    });

    $host.on("click", ".aqb-audit-prev", function () {
      if (state.offset === 0) return;
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      refresh();
    });

    $host.on("click", ".aqb-audit-next", function () {
      if (state.offset + PAGE_SIZE >= state.total) return;
      state.offset += PAGE_SIZE;
      refresh();
    });

    $host.on("click", ".aqb-audit-csv", function () {
      bus.downloadAuditCsv({ stream: state.stream || undefined, limit: 1000 });
    });
  }

  $(function () {
    const $host = $("#aquabutler-audit-log-host");
    if ($host.length === 0) return;
    bootstrap($host);
  });
})(jQuery);