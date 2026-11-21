import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { ago, channelLabel, timingLabel } from "./format.js";
import { runItemAction, type QueueItem } from "./queue-actions.js";
import {
  VIEWS,
  addDays,
  dueUnplanned,
  groupByDate,
  inView,
  localDate,
  nextMonday,
  parsePlanDate,
  planLabel,
  planState,
  viewCounts,
  type QueueView,
} from "./queue-view.js";
import { SectionPanel, esc } from "./webview-base.js";

const QUEUE_STYLE = `
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 12px; }
  .tab.active { background: var(--mind-accent); color: var(--mind-accent-fg); border-color: transparent; }
  .tab .count { opacity: 0.8; margin-left: 6px; font-size: 0.9em; }
  .tab.drop-over { outline: 2px dashed var(--mind-accent); outline-offset: 2px; }
  .up-next { border-left: 3px solid var(--mind-accent); }
  .plan-chip { font-size: 0.85em; padding: 1px 8px; border-radius: 10px; background: var(--mind-row-alt); }
  .plan-chip.overdue { color: var(--mind-yellow); }
  .group-title { margin: 14px 0 6px; font-weight: 600; }
  .queue-item { cursor: grab; }
  .queue-item.dragging { opacity: 0.45; }
  .queue-item .handle { opacity: 0.5; margin-right: 6px; user-select: none; }
  .queue-item:focus-visible { outline: 2px solid var(--mind-accent); outline-offset: 2px; }
  .timing { font-size: 0.85em; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; white-space: nowrap; }
  .timing.now { color: var(--mind-red); }
  .timing.today { color: var(--mind-yellow); }
  .timing.this-week { color: var(--mind-accent); }
  .timing.can-wait { color: var(--vscode-descriptionForeground, inherit); }
  .draft-preview { margin-top: 4px; padding-left: 8px; border-left: 3px solid var(--vscode-textBlockQuote-border, #888); opacity: 0.85; }
`;

/**
 * Drag to reorder: the card under the pointer is moved in the DOM as you
 * drag, and the full id order is posted on drop. Alt+Up / Alt+Down moves a
 * focused card for keyboard use. The extension saves the order and does not
 * re-render, so the list does not jump.
 */
const QUEUE_SCRIPT = `
(function () {
  var list = document.getElementById('queue-list');
  if (!list) return;
  var dragged = null;
  var droppedOnTab = false;

  document.querySelectorAll('[data-drop]').forEach(function (tab) {
    tab.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault();
      tab.classList.add('drop-over');
    });
    tab.addEventListener('dragleave', function () { tab.classList.remove('drop-over'); });
    tab.addEventListener('drop', function (e) {
      if (!dragged) return;
      e.preventDefault();
      tab.classList.remove('drop-over');
      droppedOnTab = true;
      post({ command: 'plan', item: dragged.dataset.itemId, when: tab.getAttribute('data-drop') });
    });
  });

  function ids() {
    return Array.prototype.map.call(list.querySelectorAll('.queue-item'), function (c) { return c.dataset.itemId; });
  }
  function save() { post({ command: 'reorder', ids: ids() }); }

  function cardAfter(y) {
    var cards = Array.prototype.filter.call(list.querySelectorAll('.queue-item'), function (c) { return c !== dragged; });
    var best = null, bestOffset = Number.NEGATIVE_INFINITY;
    cards.forEach(function (c) {
      var box = c.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = c; }
    });
    return best;
  }

  list.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.queue-item');
    if (!card) return;
    dragged = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.itemId);
  });
  list.addEventListener('dragover', function (e) {
    if (!dragged) return;
    e.preventDefault();
    var after = cardAfter(e.clientY);
    if (after) list.insertBefore(dragged, after); else list.appendChild(dragged);
  });
  list.addEventListener('drop', function (e) { if (dragged) e.preventDefault(); });
  list.addEventListener('dragend', function () {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged = null;
    if (droppedOnTab) { droppedOnTab = false; return; }
    save();
  });

  list.addEventListener('keydown', function (e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    var card = e.target.closest && e.target.closest('.queue-item');
    if (!card || e.target !== card) return;
    e.preventDefault();
    var sibling = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    if (e.key === 'ArrowUp') list.insertBefore(card, sibling); else list.insertBefore(sibling, card);
    card.focus();
    save();
  });
})();
`;

/**
 * Queue — plan the work, then do it. Every item is either planned for a day
 * or in the backlog. Today is the working list: what you planned for today
 * plus anything carried over. Each item shows when it needs you (and why) and
 * offers the actions that fit it. Drag cards to reorder, or drop one on the
 * Today or Backlog tab to plan it.
 */
export class QueuePanel extends SectionPanel {
  private static current: QueuePanel | undefined;
  /** Remembered between reopenings of the panel. */
  private static view: QueueView = "today";
  private items: QueueItem[] = [];
  private loadError: string | undefined;

  static show(): void {
    if (QueuePanel.current) {
      QueuePanel.current.reveal();
      QueuePanel.current.load();
      return;
    }
    QueuePanel.current = new QueuePanel();
  }

  /** Called by other panels after they change queue state. */
  static refreshIfOpen(): void {
    QueuePanel.current?.load();
  }

  private constructor() {
    super("mind.queue", "Queue — mind");
    this.load();
  }

  protected onDispose(): void {
    QueuePanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as {
      command?: string;
      item?: string;
      act?: string;
      ids?: unknown;
      id?: string;
      view?: string;
      when?: string;
    };
    if (m.command === "refresh") this.load();
    else if (m.command === "view" && VIEWS.some((v) => v.id === m.view)) {
      QueuePanel.view = m.view as QueueView;
      this.load();
    } else if (m.command === "plan" && m.item && m.when) this.plan(m.item, m.when);
    else if (m.command === "planDue") this.planDue();
    else if (m.command === "itemAction" && m.item && m.act) this.runAction(m.item, m.act);
    else if (m.command === "details" && m.item) {
      vscode.commands.executeCommand("mind.queue.item", m.item);
    } else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    } else if (m.command === "reorder" && Array.isArray(m.ids)) {
      this.saveOrder(m.ids.filter((v): v is string => typeof v === "string"));
    }
  }

  private async load(): Promise<void> {
    try {
      this.items = await apiFetch<QueueItem[]>("/queue");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async runAction(itemId: string, actionId: string): Promise<void> {
    // Look the action up from loaded data; the webview only supplies ids.
    const item = this.items.find((i) => i.id === itemId);
    const action = item?.actions.find((a) => a.id === actionId);
    if (!item || !action) return;
    if (await runItemAction(item, action)) this.load();
  }

  /** Plans one item: "today", "tomorrow", "backlog", or "choose" to pick. */
  private async plan(itemId: string, when: string): Promise<void> {
    if (!this.items.some((i) => i.id === itemId)) return;
    const today = localDate();
    let date: string | null | undefined;
    if (when === "today") date = today;
    else if (when === "tomorrow") date = addDays(today, 1);
    else if (when === "backlog") date = null;
    else if (when === "choose") date = await this.pickDate(today);
    if (date === undefined) return;
    await this.savePlan([itemId], date);
  }

  /** Plans every unplanned item that is already due, for today. */
  private async planDue(): Promise<void> {
    const today = localDate();
    const ids = dueUnplanned(this.items, today).map((i) => i.id);
    if (ids.length > 0) await this.savePlan(ids, today);
  }

  /** undefined = cancelled, null = backlog, otherwise a date. */
  private async pickDate(today: string): Promise<string | null | undefined> {
    const fmt = (d: string) => planLabel(d, today);
    const choices: Array<{ label: string; description?: string; date: string | null | "custom" }> = [
      { label: "Today", description: today, date: today },
      { label: "Tomorrow", description: addDays(today, 1), date: addDays(today, 1) },
      { label: "Next Monday", description: fmt(nextMonday(today)), date: nextMonday(today) },
      { label: "In a week", description: fmt(addDays(today, 7)), date: addDays(today, 7) },
      { label: "Pick a date…", date: "custom" },
      { label: "Backlog", description: "no plan", date: null },
    ];
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: "Plan this for…" });
    if (!picked) return undefined;
    if (picked.date !== "custom") return picked.date;
    const typed = await vscode.window.showInputBox({
      prompt: "Date to deal with this (YYYY-MM-DD)",
      value: addDays(today, 2),
      validateInput: (v) => (parsePlanDate(v, today) ? undefined : "Enter a real date, today or later: YYYY-MM-DD"),
    });
    return typed === undefined ? undefined : parsePlanDate(typed, today);
  }

  private async savePlan(ids: string[], date: string | null): Promise<void> {
    try {
      await apiFetch("/queue/plan", { method: "PUT", body: JSON.stringify({ ids, date }) });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not save the plan. ${String(err)}`);
    }
    this.load();
  }

  private async saveOrder(ids: string[]): Promise<void> {
    // `ids` are the items in the current view, in their new order. The server
    // puts them back into the slots they occupied; other items are untouched.
    try {
      await apiFetch("/queue/order", { method: "PUT", body: JSON.stringify({ ids }) });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not save the order. ${String(err)}`);
      this.load();
    }
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Queue",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const today = localDate();
    const view = QueuePanel.view;
    const counts = viewCounts(this.items, today);
    const shown = this.items.filter((i) => inView(i, view, today));

    const tabs = VIEWS.map(
      (v) =>
        `<button class="tab ${v.id === view ? "active" : ""}" data-action="view" data-view="${v.id}"${
          v.id === "today" ? ' data-drop="today"' : v.id === "backlog" ? ' data-drop="backlog"' : ""
        }>${esc(v.label)}<span class="count">${counts[v.id]}</span></button>`,
    ).join("");

    let content: string;
    if (view === "upcoming") {
      // Grouped by day; ordering within a day is by the saved order, but
      // cross-day dragging is not offered, so cards are not draggable here.
      content = groupByDate(shown)
        .map(
          (g) => `<div class="group-title">${esc(planLabel(g.date, today))} <span class="meta">${g.items.length}</span></div>
            ${g.items.map((i) => this.renderItem(i, today, false)).join("")}`,
        )
        .join("");
    } else {
      content = shown.map((i, n) => this.renderItem(i, today, true, view === "today" && n === 0)).join("");
    }

    const due = view === "today" ? dueUnplanned(this.items, today) : [];
    const dueBanner =
      due.length > 0
        ? `<div class="card" style="border-left: 3px solid var(--mind-red);">
             <strong>${due.length} unplanned item${due.length === 1 ? " is" : "s are"} due today or already overdue.</strong>
             <div class="toolbar" style="margin: 6px 0 0;"><button data-action="planDue">Add ${due.length === 1 ? "it" : "them"} to today</button></div>
           </div>`
        : "";

    const empty: Record<QueueView, string> = {
      today: `Nothing is planned for today.${
        counts.backlog > 0
          ? ` <button data-action="view" data-view="backlog">Plan from the backlog (${counts.backlog})</button>`
          : ""
      }`,
      upcoming: "Nothing is planned for a later day.",
      backlog: "The backlog is empty. Everything awaiting action has a plan.",
      all: "Nothing is awaiting action.",
    };

    const hint =
      view === "upcoming"
        ? "grouped by planned day"
        : "drag to reorder · drop on Today or Backlog to plan · Alt+↑/↓ moves a focused card";
    const body = `
      <div class="tabs">${tabs}</div>
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        <span class="meta">${shown.length} awaiting action · ${esc(hint)}</span>
      </div>
      ${dueBanner}
      <div id="queue-list">${content}</div>
      ${shown.length === 0 ? `<p class="empty">${empty[view]}</p>` : ""}
    `;
    this.panel.webview.html = this.shell("Queue", body, QUEUE_STYLE, QUEUE_SCRIPT);
  }

  private renderItem(item: QueueItem, today: string, draggable: boolean, upNext = false): string {
    const buttons = item.actions
      // An open-link button only appears when the message contains that link.
      .filter((a) => a.kind !== "openLink" || a.linkAvailable !== false)
      .map(
        (a) =>
          `<button data-action="itemAction" data-item="${esc(item.id)}" data-act="${esc(a.id)}">${esc(a.label)}</button>`,
      )
      .join("");

    const state = planState(item.plannedFor, today);
    const planButtons = [
      state !== "today" && state !== "overdue" ? "today" : null,
      item.plannedFor !== addDays(today, 1) ? "tomorrow" : null,
    ]
      .filter((w): w is "today" | "tomorrow" => w !== null)
      .map(
        (w) =>
          `<button data-action="plan" data-item="${esc(item.id)}" data-when="${w}">${w === "today" ? "Today" : "Tomorrow"}</button>`,
      )
      .join("");

    return `<div class="card queue-item${upNext ? " up-next" : ""}"${draggable ? ' draggable="true"' : ""} tabindex="0" data-item-id="${esc(item.id)}">
      <div class="toolbar" style="justify-content: space-between; margin-bottom: 4px;">
        <span>${draggable ? '<span class="handle" aria-hidden="true">⠿</span>' : ""}${upNext ? '<span class="badge">Up next</span> ' : ""}<span class="badge">${esc(channelLabel(item.adapter, item.account))}</span> ${esc(item.sender)}</span>
        <span class="timing ${esc(item.timing.bucket)}" title="${esc(item.timing.reason)}">${esc(timingLabel(item.timing.bucket, item.timing.actBy))}</span>
      </div>
      <div><strong>${esc(item.summary)}</strong></div>
      ${item.draftPreview ? `<div class="draft-preview"><span class="meta">Draft reply:</span> ${esc(item.draftPreview)}</div>` : ""}
      <div class="meta" style="margin-top: 4px;">${esc(item.timing.reason)}</div>
      <div class="meta">${item.direction ? `${esc(item.direction.name)} · ` : ""}received ${esc(ago(item.receivedAt))} · <span class="plan-chip ${state === "overdue" ? "overdue" : ""}">${esc(planLabel(item.plannedFor, today))}</span></div>
      <div class="toolbar" style="margin-top: 8px; margin-bottom: 0;">
        ${buttons}
        <span class="meta">Plan:</span>${planButtons}<button data-action="plan" data-item="${esc(item.id)}" data-when="choose">Plan…</button>
        <button data-action="details" data-item="${esc(item.id)}">Details</button>
        <button data-action="open" data-id="${esc(item.signalId)}">View signal</button>
      </div>
    </div>`;
  }
}
