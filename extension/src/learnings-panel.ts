import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { ago } from "./format.js";
import type { ProposalView, ScheduleView } from "./learnings-model.js";
import { describeProposal, describeSchedule } from "./learnings-model.js";
import { esc, SectionPanel } from "./webview-base.js";

type DirectionProposal = ProposalView;

interface LearningFile {
  id: string;
  path: string;
  title: string;
  applies: "classify" | "draft" | "both";
  direction: string | null;
  enabled: boolean;
  body: string;
}

interface LearningFiles {
  dir: string;
  learnings: LearningFile[];
  problems: { id: string; path: string; reason: string }[];
}

interface StoredProposal {
  eventId: string;
  at: string;
  proposal: DirectionProposal;
  status: "pending" | "accepted" | "rejected";
  /** For an accepted proposal: the edit to make by hand in directions/. */
  yamlChange?: string | null;
}

interface JournalEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  payload: string;
}

interface LearningInsight {
  at: string;
  insight: string;
  proposalCount: number;
}

/**
 * Learnings — two things. Your learnings: the notes in learnings/*.md that
 * are added to the classifier and drafter prompts (GET /learnings). And
 * suggestions: the rule-based loop's proposals to change a Direction
 * (GET /proposals), shown in plain language (learnings-model.ts).
 *
 * The suggestions are rule-based and deterministic: a nightly pass scans
 * events and proposes narrow/widen/new only when an override rate crosses a
 * fixed threshold — nothing here is decided by a model. Running the loop also asks the configured model
 * (Ollama by default) for a short, plain-language explanation of *why*
 * the pattern is happening, shown separately as an Insight — never a
 * substitute for the counted evidence above it, and skipped quietly if
 * no provider is configured. Reclassifications (signal.reclassified
 * events) are the separate correction path for when the match itself
 * was wrong, shown below as its own list, same split the mockup makes.
 */
export class LearningsPanel extends SectionPanel {
  private static current: LearningsPanel | undefined;
  private proposals: StoredProposal[] = [];
  private reclassifications: JournalEvent[] = [];
  private insights: LearningInsight[] = [];
  private schedule: ScheduleView | undefined;
  private files: LearningFiles | undefined;
  private loadError: string | undefined;
  /** True while a learning run is in progress, started here or by the nightly schedule. */
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  static show(): void {
    if (LearningsPanel.current) {
      LearningsPanel.current.reveal();
      return;
    }
    LearningsPanel.current = new LearningsPanel();
  }

  private constructor() {
    super("mind.learnings", "Learnings — mind");
    this.load();
  }

  protected onDispose(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    LearningsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; id?: string };
    if (m.command === "openLearning" && m.id) {
      // The path comes from the server's list, never from the message.
      const file =
        this.files?.learnings.find((l) => l.id === m.id)?.path ??
        this.files?.problems.find((l) => l.id === m.id)?.path;
      if (file) void vscode.window.showTextDocument(vscode.Uri.file(file));
      return;
    }
    if (m.command === "refresh") this.load();
    else if (m.command === "run") this.runLearningLoop();
    else if (m.command === "accept" && m.id) this.resolve(m.id, "accept");
    else if (m.command === "reject" && m.id) this.resolve(m.id, "reject");
  }

  private async load(): Promise<void> {
    try {
      const [proposals, reclassifications, insights, schedule, files] = await Promise.all([
        apiFetch<StoredProposal[]>("/proposals"),
        apiFetch<JournalEvent[]>("/events?kind=signal.reclassified&limit=100"),
        apiFetch<LearningInsight[]>("/proposals/insights?limit=5"),
        apiFetch<ScheduleView>("/proposals/schedule"),
        apiFetch<LearningFiles>("/learnings"),
      ]);
      this.schedule = schedule;
      this.running = schedule.running === true;
      this.files = files;
      this.proposals = proposals;
      this.reclassifications = reclassifications;
      this.insights = insights;
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
    // A run started elsewhere (the nightly schedule) is picked up here, and the
    // panel keeps checking until it ends, so the button re-enables by itself.
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = this.running ? setTimeout(() => void this.load(), 2000) : undefined;
  }

  private async runLearningLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.render();
    try {
      const result = await apiFetch<{ proposals: unknown[]; insight: string | null }>(
        "/proposals/run",
        { method: "POST" },
      );
      if (!result.insight) {
        vscode.window.showInformationMessage(
          "mind: learning loop ran. No AI explanation — configure a provider (mind: Configure AI Provider) to get a plain-language explanation of the pattern.",
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.running = false;
    this.load();
  }

  private async resolve(id: string, action: "accept" | "reject"): Promise<void> {
    try {
      const result = await apiFetch<{ yamlChange?: string | null }>(`/proposals/${id}/${action}`, {
        method: "POST",
      });
      if (action === "accept" && result.yamlChange) {
        vscode.window.showInformationMessage(`mind: ${result.yamlChange}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Learnings",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const card = (p: StoredProposal): string => {
      const t = describeProposal(p.proposal);
      const next =
        p.status === "accepted" && p.yamlChange
          ? `<div class="sub"><strong>Your next step:</strong> ${esc(p.yamlChange)}. mind does not edit your Direction files, so until you make this change a restart will undo it.</div>`
          : "";
      const actions =
        p.status === "pending"
          ? `<button data-action="accept" data-id="${esc(p.eventId)}">Accept</button>
             <button data-action="reject" data-id="${esc(p.eventId)}">Reject</button>`
          : `<span class="badge">${esc(p.status)}</span>`;
      return `<div class="card">
        <div><strong>${esc(t.headline)}</strong></div>
        <div>${esc(t.change)}</div>
        <div class="sub">Why: ${esc(t.why)}</div>
        <div class="sub">${esc(t.effect)}</div>
        ${next}
        <div class="toolbar" style="margin-top: 6px; margin-bottom: 0;">${actions}</div>
      </div>`;
    };
    const pending = this.proposals.filter((p) => p.status === "pending");
    const resolved = this.proposals.filter((p) => p.status !== "pending");
    const proposalRows = pending.map(card).join("");
    const resolvedRows = resolved.map(card).join("");

    const files = this.files;
    const learningRows = (files?.learnings ?? [])
      .map((l) => {
        const scope = [
          l.applies === "both" ? "classify and draft" : l.applies,
          l.direction ? `only ${l.direction}` : "every Direction",
          l.enabled ? "on" : "off",
        ].join(" · ");
        return `<div class="card">
          <div><strong>${esc(l.title)}</strong> <span class="sub">${esc(scope)}</span></div>
          <div class="sub">${esc(l.body)}</div>
          <div class="toolbar" style="margin-top: 6px; margin-bottom: 0;">
            <button data-action="openLearning" data-id="${esc(l.id)}">Edit file</button>
          </div>
        </div>`;
      })
      .join("");
    const problemRows = (files?.problems ?? [])
      .map(
        (
          p,
        ) => `<div class="card"><div class="danger">${esc(p.id)}.md is not used: ${esc(p.reason)}</div>
          <div class="toolbar" style="margin-top: 6px; margin-bottom: 0;"><button data-action="openLearning" data-id="${esc(p.id)}">Edit file</button></div></div>`,
      )
      .join("");

    const reclassRows = this.reclassifications
      .map((e) => {
        let detail: {
          signalId?: string;
          fromDirectionId?: string;
          toDirectionId?: string;
          reason?: string;
        } = {};
        try {
          detail = JSON.parse(e.payload);
        } catch {
          /* show what we can */
        }
        return `<tr>
          <td>${esc(e.at)}</td>
          <td>${esc(detail.signalId ?? "—")}</td>
          <td>${esc(detail.fromDirectionId ?? "—")} → ${esc(detail.toDirectionId ?? "—")}</td>
          <td class="meta">${esc(detail.reason ?? "—")}</td>
        </tr>`;
      })
      .join("");

    const insightCards = this.insights
      .map(
        (i) => `<div class="card insight-card">
          <div class="sub">${esc(i.at)} · ${i.proposalCount} proposal${i.proposalCount === 1 ? "" : "s"}</div>
          <div>${esc(i.insight)}</div>
        </div>`,
      )
      .join("");

    const body = `
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        <button data-action="run"${this.running ? ' disabled title="The learning loop is running"' : ""}>${this.running ? "Running…" : "Run learning loop now"}</button>
      </div>
      <h2>Your learnings (${files?.learnings.length ?? 0})</h2>
      <p class="sub">Plain notes you write in <code>${esc(files?.dir ?? "learnings")}</code>, one <code>.md</code> file each. They are added to the prompts the classifier and drafter see, so edit them like any file and commit them to git. They can change how a message is judged or worded. They cannot allow a send.</p>
      ${learningRows || '<p class="empty">No learnings yet. Add a file such as learnings/tone.md. See learnings/README.md.</p>'}
      ${problemRows}
      <h2>Suggested changes to Directions (${pending.length})</h2>
      <p class="sub">${esc(this.schedule ? describeSchedule(this.schedule, (iso) => `${new Date(iso).toLocaleString()} (${ago(iso)})`) : "")}</p>
      <p class="sub">Each suggestion comes from counting what you approved and discarded in the last 7 days. Nothing changes until you accept it.</p>
      ${proposalRows || '<p class="empty">Nothing to suggest right now.</p>'}
      ${resolvedRows ? `<h2>Already answered (${resolved.length})</h2>${resolvedRows}` : ""}
      <h2>AI explanation</h2>
      <p class="sub">A model's short reading of why the suggestions above came up. It is commentary, not a decision.</p>
      ${insightCards || '<p class="empty">None yet. It appears after a run when an AI provider is configured.</p>'}
      <h2>Moved to a different Direction by you</h2>
      ${
        this.reclassifications.length > 0
          ? `<table>
              <thead><tr><th>When</th><th>Signal</th><th>Moved</th><th>Reason</th></tr></thead>
              <tbody>${reclassRows}</tbody>
            </table>`
          : '<p class="empty">No reclassifications yet.</p>'
      }
    `;

    this.panel.webview.html = this.shell("Learnings", body);
  }
}
