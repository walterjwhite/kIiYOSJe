import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { ago, channelLabel } from "./format.js";
import type { Goal } from "./goals.js";
import { QueuePanel } from "./queue-panel.js";
import { editableField, esc, SectionPanel } from "./webview-base.js";

interface LinkedSignal {
  id: string;
  adapter: string;
  account: string | null;
  sender: string;
  subject: string | null;
  body: string;
  transformedSummary: string | null;
  disposition: string;
  receivedAt: string;
}

type Tab = "details" | "signals";

const STYLE = `
  .tabs { display: flex; gap: 6px; margin: 0 0 12px; }
  .tab.active { background: var(--mind-accent); color: var(--mind-accent-fg); border-color: transparent; }
  .pane[hidden] { display: none; }
`;

const SCRIPT = `
(function () {
  var tabs = document.querySelectorAll('[data-tab]');
  var panes = document.querySelectorAll('[data-pane]');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-tab');
      tabs.forEach(function (o) { o.classList.toggle('active', o === t); });
      panes.forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
      post({ command: 'tab', tab: name });
    });
  });
})();
`;

/**
 * Goal detail, opened by clicking a goal in the Queue. The Details tab shows
 * the goal and lets you rename it; the Signals tab lists every signal linked
 * to it, not only those still awaiting action.
 */
export class GoalDetailPanel extends SectionPanel {
  private static readonly open = new Map<string, GoalDetailPanel>();
  private goal: Goal | undefined;
  private goals: Goal[] = [];
  private signals: LinkedSignal[] = [];
  private tab: Tab = "details";
  private error: string | undefined;
  private gone = false;

  static show(goalId: string): void {
    const existing = GoalDetailPanel.open.get(goalId);
    if (existing) {
      existing.reveal();
      void existing.load();
      return;
    }
    GoalDetailPanel.open.set(goalId, new GoalDetailPanel(goalId));
  }

  /** Called by the Queue after it changes goals. */
  static refreshIfOpen(): void {
    for (const p of GoalDetailPanel.open.values()) void p.load();
  }

  private constructor(private readonly goalId: string) {
    super(`mind.goal.${goalId}`, "Goal — mind");
    void this.load();
  }

  protected onDispose(): void {
    GoalDetailPanel.open.delete(this.goalId);
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; value?: string; id?: string; tab?: string };
    if (m.command === "refresh") void this.load();
    else if (m.command === "tab" && (m.tab === "details" || m.tab === "signals")) {
      this.tab = m.tab;
    } else if (m.command === "renameGoal" && typeof m.value === "string") {
      void this.rename(m.value);
    } else if (m.command === "open" && m.id) {
      void vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      const [goals, signals] = await Promise.all([
        apiFetch<Goal[]>("/thoughts?state=goal"),
        apiFetch<LinkedSignal[]>(`/signals?range=all&thoughtId=${encodeURIComponent(this.goalId)}`),
      ]);
      this.goals = goals;
      this.goal = goals.find((g) => g.id === this.goalId);
      this.gone = this.goal === undefined;
      this.signals = signals;
      this.error = undefined;
      if (this.goal) this.panel.title = `${this.goal.title.slice(0, 40)} — Goal`;
    } catch (err) {
      this.error = String(err);
    }
    this.render();
  }

  private async rename(value: string): Promise<void> {
    const title = value.trim();
    if (!title || title === this.goal?.title) {
      this.render();
      return;
    }
    try {
      await apiFetch(`/thoughts/${encodeURIComponent(this.goalId)}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(`mind: could not rename the goal. ${String(err)}`);
    }
    QueuePanel.refreshIfOpen();
    await this.load();
  }

  private render(): void {
    if (this.error) {
      this.panel.webview.html = this.shell(
        "Goal",
        `<p class="danger">Can't load this goal.</p><p class="sub">${esc(this.error)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }
    const goal = this.goal;
    if (!goal) {
      this.panel.webview.html = this.shell(
        "Goal",
        this.gone ? '<p class="empty">This goal is no longer open.</p>' : "",
      );
      return;
    }

    const parent = this.goals.find((g) => g.id === goal.parentId);
    const subGoals = this.goals.filter((g) => g.parentId === goal.id);
    const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;

    const details = `
      <table>
        ${row("Next action", esc(goal.nextAction ?? "—"))}
        ${row("Review at", esc(goal.reviewAt ?? "—"))}
        ${row("Escalate by", esc(goal.escalateBy ?? "—"))}
        ${row("Sub-goal of", esc(parent?.title ?? "— (top level)"))}
        ${row("Sub-goals", subGoals.length ? subGoals.map((g) => esc(g.title)).join(", ") : "—")}
      </table>
      ${goal.body ? `<h2>Notes</h2><p class="card" style="white-space: pre-wrap;">${esc(goal.body)}</p>` : ""}`;

    const rows = this.signals
      .map(
        (s) => `<tr class="clickable" data-action="open" data-id="${esc(s.id)}">
          <td>${esc(channelLabel(s.adapter, s.account))}</td>
          <td>${esc(s.sender)}</td>
          <td>${esc(s.subject ?? s.transformedSummary ?? s.body.slice(0, 100))}</td>
          <td>${esc(s.disposition)}</td>
          <td title="${esc(s.receivedAt)}">${esc(ago(s.receivedAt))}</td>
        </tr>`,
      )
      .join("");
    const signals = this.signals.length
      ? `<table><thead><tr><th>Channel</th><th>From</th><th>Subject</th><th>Status</th><th>Received</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty">No signals are linked to this goal.</p>';

    const tabButton = (id: Tab, label: string) =>
      `<button class="tab${this.tab === id ? " active" : ""}" data-tab="${id}">${label}</button>`;

    const body = `
      <h2 style="margin-top: 0;">${editableField(goal.title, "renameGoal", {})}</h2>
      <div class="tabs">${tabButton("details", "Details")}${tabButton("signals", `Signals (${this.signals.length})`)}</div>
      <div class="pane" data-pane="details"${this.tab === "details" ? "" : " hidden"}>${details}</div>
      <div class="pane" data-pane="signals"${this.tab === "signals" ? "" : " hidden"}>${signals}</div>`;
    this.panel.webview.html = this.shell(goal.title.slice(0, 80), body, STYLE, SCRIPT);
  }
}
