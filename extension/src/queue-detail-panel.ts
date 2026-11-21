import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { ago, channelLabel, timingLabel } from "./format.js";
import { runItemAction, type QueueItem } from "./queue-actions.js";
import { QueuePanel } from "./queue-panel.js";
import { renderEventDetail } from "./signal-detail-panel.js";
import { SectionPanel, esc } from "./webview-base.js";

interface Detail {
  item: QueueItem;
  signal: {
    id: string;
    sender: string;
    recipients: string;
    subject: string | null;
    body: string;
    transformedSummary: string | null;
    receivedAt: string;
    disposition: string;
    escalateBy: string | null;
  };
  draft: string | null;
  thread: Array<{
    id: string;
    adapter: string;
    account: string | null;
    sender: string;
    subject: string | null;
    body: string;
    receivedAt: string;
    disposition: string;
    current: boolean;
  }>;
  thought: {
    id: string;
    title: string;
    body: string;
    state: string;
    nextAction: string | null;
    reviewAt: string | null;
    disputedReason: string | null;
    commitment: { text?: string; dueDate?: string | null; status?: string } | null;
  } | null;
  direction: {
    id: string;
    name: string;
    posture: string;
    autonomy: string;
    standard: string;
  } | null;
  actions: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
    sentAt: string | null;
  }>;
  events: Array<{ id: string; at: string; actor: string; kind: string; payload: string }>;
}

/**
 * Queue item detail: everything relevant to one item in one place. The
 * item and its actions, why it is (or is not) time-sensitive, the full draft,
 * the conversation it belongs to, the thought and commitment it is linked
 * to, the direction that matched, and the event history.
 */
export class QueueDetailPanel extends SectionPanel {
  private static readonly open = new Map<string, QueueDetailPanel>();
  private data: Detail | undefined;
  private error: string | undefined;
  private resolved = false;

  static show(itemId: string): void {
    const existing = QueueDetailPanel.open.get(itemId);
    if (existing) {
      existing.reveal();
      existing.load();
      return;
    }
    QueueDetailPanel.open.set(itemId, new QueueDetailPanel(itemId));
  }

  private constructor(private readonly itemId: string) {
    super(`mind.queue.item.${itemId}`, "Queue item — mind");
    this.load();
  }

  protected onDispose(): void {
    QueueDetailPanel.open.delete(this.itemId);
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; act?: string; id?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "itemAction" && m.act) this.runAction(m.act);
    else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      this.data = await apiFetch<Detail>(`/queue/${encodeURIComponent(this.itemId)}`);
      this.error = undefined;
      this.resolved = false;
      this.panel.title = `${this.data.item.summary.slice(0, 40)} — Queue`;
    } catch (err) {
      // A 404 after an action means the item left the queue, which is success.
      if (String(err).includes(" 404 ")) this.resolved = true;
      else this.error = String(err);
    }
    this.render();
  }

  private async runAction(actionId: string): Promise<void> {
    const item = this.data?.item;
    const action = item?.actions.find((a) => a.id === actionId);
    if (!item || !action) return;
    const changed = await runItemAction(item, action);
    if (changed) QueuePanel.refreshIfOpen();
    await this.load();
  }

  private render(): void {
    if (this.error) {
      this.panel.webview.html = this.shell(
        "Queue item",
        `<p class="danger">Can't load this item.</p><p class="sub">${esc(this.error)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }
    if (this.resolved) {
      this.panel.webview.html = this.shell(
        "Queue item",
        `<p class="empty">This item is no longer in the queue. It was acted on or resolved.</p>
         ${this.data ? `<button data-action="open" data-id="${esc(this.data.signal.id)}">View signal</button>` : ""}`,
      );
      return;
    }
    const d = this.data;
    if (!d) return;
    const { item, signal } = d;

    const buttons = item.actions
      .filter((a) => a.kind !== "openLink" || a.linkAvailable !== false)
      .map(
        (a) => `<button data-action="itemAction" data-act="${esc(a.id)}">${esc(a.label)}</button>`,
      )
      .join("");

    const a = item.assessment;
    const assessment = a
      ? `<table>
          ${a.intent ? `<tr><th>Intent</th><td>${esc(a.intent)}</td></tr>` : ""}
          <tr><th>Kind</th><td>${esc(a.signalKind ?? "—")}</td></tr>
          <tr><th>Urgency</th><td>${esc(a.urgency ?? "—")}</td></tr>
          <tr><th>Confidence</th><td>${a.confidence === null ? "—" : esc(String(a.confidence))}</td></tr>
          <tr><th>Answerable by AI</th><td>${a.answerable === null ? "—" : a.answerable ? "yes" : "no"}</td></tr>
        </table>`
      : '<p class="empty">No classification recorded.</p>';

    const thread = d.thread
      .map(
        (
          s,
        ) => `<div class="card"${s.current ? ' style="border-left: 3px solid var(--mind-accent);"' : ""}>
          <div class="toolbar" style="margin-bottom: 4px;">
            <span class="badge">${esc(channelLabel(s.adapter, s.account))}</span>
            <strong>${esc(s.sender)}</strong>
            <span class="meta">${esc(s.receivedAt)} · ${esc(ago(s.receivedAt))} · ${esc(s.disposition)}${s.current ? " · this item" : ""}</span>
          </div>
          ${s.subject ? `<div><strong>${esc(s.subject)}</strong></div>` : ""}
          <div class="sub" style="white-space: pre-wrap;">${esc(s.body.slice(0, 600))}${s.body.length > 600 ? "…" : ""}</div>
          ${s.current ? "" : `<div class="toolbar" style="margin: 6px 0 0;"><button data-action="open" data-id="${esc(s.id)}">View signal</button></div>`}
        </div>`,
      )
      .join("");

    const t = d.thought;
    const thought = t
      ? `<table>
          <tr><th>Title</th><td>${esc(t.title)}</td></tr>
          <tr><th>State</th><td><span class="badge">${esc(t.state)}</span></td></tr>
          <tr><th>Next action</th><td>${esc(t.nextAction ?? "—")}</td></tr>
          <tr><th>Review at</th><td>${esc(t.reviewAt ?? "—")}</td></tr>
          ${t.disputedReason ? `<tr><th>Blocked by</th><td>${esc(t.disputedReason)}</td></tr>` : ""}
          ${t.commitment?.text ? `<tr><th>Commitment</th><td>${esc(t.commitment.text)}${t.commitment.dueDate ? ` (due ${esc(t.commitment.dueDate)})` : ""}${t.commitment.status ? ` · ${esc(t.commitment.status)}` : ""}</td></tr>` : ""}
        </table>`
      : '<p class="empty">Not linked to a thought.</p>';

    const dir = d.direction;
    const direction = dir
      ? `<table>
          <tr><th>Name</th><td>${esc(dir.name)}</td></tr>
          <tr><th>Posture</th><td>${esc(dir.posture)}</td></tr>
          <tr><th>Autonomy</th><td>${esc(dir.autonomy)}</td></tr>
          <tr><th>Guidance</th><td>${esc(dir.standard)}</td></tr>
        </table>`
      : '<p class="empty">No direction matched.</p>';

    const actionHistory = d.actions.length
      ? `<table>${d.actions
          .map(
            (x) =>
              `<tr><td>${esc(x.kind)}</td><td><span class="badge">${esc(x.status)}</span></td><td class="meta">created ${esc(x.createdAt)}${x.sentAt ? ` · sent ${esc(x.sentAt)}` : ""}</td></tr>`,
          )
          .join("")}</table>`
      : '<p class="empty">No actions were proposed for this signal.</p>';

    const history = d.events
      .map((e) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(e.payload);
        } catch {
          /* kind-only row */
        }
        return `<div class="card event-card">
          <div class="toolbar" style="margin-bottom: 4px;">
            <span class="badge">${esc(e.kind)}</span>
            <span class="meta">${esc(e.at)} · ${esc(e.actor)}</span>
          </div>
          ${renderEventDetail(e.kind, payload)}
        </div>`;
      })
      .join("");

    const body = `
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        ${buttons}
        <button data-action="open" data-id="${esc(signal.id)}">View signal</button>
      </div>

      <div class="card">
        <div><strong>${esc(item.summary)}</strong></div>
        <div class="meta">${esc(channelLabel(item.adapter, item.account))} · from ${esc(signal.sender)} · received ${esc(signal.receivedAt)} (${esc(ago(signal.receivedAt))})</div>
      </div>

      <h2>When it needs you</h2>
      <table>
        <tr><th>Timing</th><td>${esc(timingLabel(item.timing.bucket, item.timing.actBy))}</td></tr>
        <tr><th>Why</th><td>${esc(item.timing.reason)}</td></tr>
        <tr><th>In queue since</th><td>${esc(item.queuedAt)} (${esc(ago(item.queuedAt))})</td></tr>
      </table>

      ${
        d.draft !== null
          ? `<h2>Drafted reply</h2><p class="card" style="white-space: pre-wrap;">${esc(d.draft)}</p>`
          : ""
      }

      <h2>Assessment</h2>
      ${assessment}

      <h2>Conversation (${d.thread.length})</h2>
      ${thread}

      <h2>Linked thought</h2>
      ${thought}

      <h2>Matched direction</h2>
      ${direction}

      <h2>Actions on this signal</h2>
      ${actionHistory}

      <h2>History</h2>
      ${history || '<p class="empty">No events recorded.</p>'}
    `;
    this.panel.webview.html = this.shell(item.summary.slice(0, 80), body);
  }
}
