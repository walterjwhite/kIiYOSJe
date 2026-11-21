import { apiFetch } from "./api-client.js";
import { jsonTextToHtml } from "./json-html.js";
import { SectionPanel, esc } from "./webview-base.js";

export type EventRange = "1h" | "4h" | "12h" | "today" | "7d" | "30d" | "all";

interface JournalEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  payload: string;
}

const RANGE_LABEL: Record<EventRange, string> = {
  "1h": "Last hour",
  "4h": "Last 4 hours",
  "12h": "Last 12 hours",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All",
};

/**
 * System Events — everything mind itself did (GET /events, excluding
 * journal.note), with the same range filter as Signals. Split out from
 * Journal, which is now only the operator's own notes — this is the
 * system's own audit trail: signal.processed, action.sent, direction
 * updates, and so on.
 */
export class SystemEventsPanel extends SectionPanel {
  private static current: SystemEventsPanel | undefined;
  private events: JournalEvent[] = [];
  private range: EventRange = "today";
  private loadError: string | undefined;

  static show(): void {
    if (SystemEventsPanel.current) {
      SystemEventsPanel.current.reveal();
      return;
    }
    SystemEventsPanel.current = new SystemEventsPanel();
  }

  private constructor() {
    super("mind.systemEvents", "System Events — mind");
    this.load();
  }

  protected onDispose(): void {
    SystemEventsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; range?: EventRange };
    if (m.command === "refresh") this.load();
    else if (m.command === "setRange" && m.range) {
      this.range = m.range;
      this.load();
    }
  }

  private async load(): Promise<void> {
    try {
      const all = await apiFetch<JournalEvent[]>(
        `/events?range=${this.range}&limit=500`,
      );
      this.events = all.filter((e) => e.kind !== "journal.note");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "System Events",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const rangeButtons = (Object.keys(RANGE_LABEL) as EventRange[])
      .map(
        (r) =>
          `<button data-action="setRange" data-range="${r}" style="${r === this.range ? "font-weight:700;" : ""}">${RANGE_LABEL[r]}</button>`,
      )
      .join("");

    const rows = this.events
      .map((e) => {
        const compact = jsonTextToHtml(e.payload);
        const pretty = jsonTextToHtml(e.payload, 2);
        return `<tr>
          <td data-sort-value="${esc(e.at)}">${esc(e.at)}</td>
          <td>${esc(e.actor)}</td>
          <td>${esc(e.kind)}</td>
          <td class="meta"><details><summary class="json">${compact}</summary><pre class="json">${pretty}</pre></details></td>
        </tr>`;
      })
      .join("");

    const body = `
      <p class="sub">What mind itself did, in order — matching, classification, drafts, sends, and every decision in between. Your own notes live in the <strong>Journal</strong> screen instead.</p>
      <div class="toolbar">
        ${rangeButtons}
        <button data-action="refresh">↺ Refresh</button>
        <span class="meta">${this.events.length} events</span>
      </div>
      ${
        this.events.length > 0
          ? `<table class="sortable">
              <thead><tr><th data-sort="text">When</th><th data-sort="text">Actor</th><th data-sort="text">Kind</th><th data-sort="text">Detail</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<p class="empty">Nothing in this range.</p>'
      }
    `;

    this.panel.webview.html = this.shell("System Events", body);
  }
}
