import { jsonToHtml } from "./json-html.js";
import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { SectionPanel, esc } from "./webview-base.js";

interface DirectionProposal {
  kind: "narrow" | "widen" | "new";
  directionId: string | null;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  evidence: { total: number; discarded: number; sent: number; overrideRate: number };
}

interface StoredProposal {
  eventId: string;
  at: string;
  proposal: DirectionProposal;
  status: "pending" | "accepted" | "rejected";
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
 * Learnings — the durable record behind Directions, matching the mockup's
 * Learnings tab. The actual proposals are still rule-based and deterministic
 * (GET /proposals): a periodic pass scans events and proposes narrow/widen/
 * new only when an override rate crosses a fixed threshold — nothing here
 * is decided by a model. Running the loop also asks the configured model
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
  private loadError: string | undefined;

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
    LearningsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; id?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "run") this.runLearningLoop();
    else if (m.command === "accept" && m.id) this.resolve(m.id, "accept");
    else if (m.command === "reject" && m.id) this.resolve(m.id, "reject");
  }

  private async load(): Promise<void> {
    try {
      const [proposals, reclassifications, insights] = await Promise.all([
        apiFetch<StoredProposal[]>("/proposals"),
        apiFetch<JournalEvent[]>("/events?kind=signal.reclassified&limit=100"),
        apiFetch<LearningInsight[]>("/proposals/insights?limit=5"),
      ]);
      this.proposals = proposals;
      this.reclassifications = reclassifications;
      this.insights = insights;
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async runLearningLoop(): Promise<void> {
    try {
      const result = await apiFetch<{ proposals: unknown[]; insight: string | null }>(
        "/proposals/run",
        { method: "POST" },
      );
      if (!result.insight) {
        vscode.window.showInformationMessage(
          "mind: learning loop ran. No AI insight — configure a provider (mind: Configure AI Provider) to get a plain-language explanation of the pattern.",
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
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

    const proposalRows = this.proposals
      .map((p) => {
        const d = p.proposal;
        const actions =
          p.status === "pending"
            ? `<button data-action="accept" data-id="${esc(p.eventId)}">Accept</button>
               <button data-action="reject" data-id="${esc(p.eventId)}">Reject</button>`
            : `<span class="badge">${esc(p.status)}</span>`;
        return `<div class="card">
          <div><span class="badge">${esc(d.kind)}</span> ${esc(d.directionId ?? "new direction")} — <strong>${esc(d.field)}</strong>: <span class="json">${jsonToHtml(d.currentValue)}</span> → <span class="json">${jsonToHtml(d.proposedValue)}</span></div>
          <div class="sub">${esc(d.rationale)}</div>
          <div class="sub">evidence: ${d.evidence.total} total, ${d.evidence.discarded} discarded, ${(d.evidence.overrideRate * 100).toFixed(0)}% override rate</div>
          <div class="toolbar" style="margin-top: 6px; margin-bottom: 0;">${actions}</div>
        </div>`;
      })
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
        <button data-action="run">Run learning loop now</button>
      </div>
      <h2>AI insight</h2>
      ${insightCards || '<p class="empty">No insight yet — run the learning loop with an AI provider configured.</p>'}
      <h2>Proposals (${this.proposals.length})</h2>
      ${proposalRows || '<p class="empty">No proposals yet.</p>'}
      <h2>Reclassifications</h2>
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
