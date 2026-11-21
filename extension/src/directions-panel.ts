import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { editAsMarkdown } from "./markdown-editor.js";
import { buildPreview, type PreviewResult } from "./preview-model.js";
import {
  editableField,
  esc,
  openInEditorLink,
  SectionPanel,
  toggleSwitch,
} from "./webview-base.js";

interface Direction {
  id: string;
  name: string;
  scopeKind: string;
  scopeValue: string;
  posture: string;
  autonomy: string;
  confidenceMin: number;
  standard: string;
  matchPrompt: string | null;
  responsePrompt: string | null;
  transformPrompt: string | null;
  enabled: boolean;
  signals: number;
  absorbed: number;
  proposed: number;
  discarded: number;
  overrideRate: number | null;
}

interface SignalRow {
  id: string;
  adapter: string;
  sender: string;
  body: string;
  disposition: string;
  receivedAt: string;
}

const POSTURE_OPTIONS = ["absorb", "draft", "surface", "escalate"] as const;
const AUTONOMY_OPTIONS = ["observe", "draft", "send"] as const;
const SCOPE_KIND_OPTIONS = ["person", "project", "topic", "thread"] as const;

/**
 * Directions — a table of every Direction plus a detail screen for the
 * one selected, matching the mockup's two-screen Directions tab. Every
 * field is editable from here, including scope/posture/autonomy, not just
 * the handful that used to be the only "live-safe" ones: the enabled
 * column/row is a toggle switch (no separate Toggle button), short fields
 * (name, confidence, scope) are click-to-edit text or a QuickPick for the
 * enum fields, and the three Markdown fields (guidance, match/response
 * prompts) open as real editor tabs named "<direction>-<field>" with
 * actual Markdown syntax highlighting — genuine highlighting from the
 * editor itself, not a webview textarea. PUT /directions/:id backs every
 * write; new Directions are still authored as YAML under directions/
 * (mind.direction.edit), the source of truth PLAN §6 describes.
 *
 * "standard" was a confusing name for what this field actually is — not a
 * formal standard, but guidance for how to recognize and respond. The API
 * and YAML field are still called `standard` (so every existing
 * directions/*.yaml file keeps working unchanged), but this UI and new
 * YAML files can both say "guidance" — the loader accepts either key.
 *
 * Transform prompt is a fourth, optional Markdown field: it rewrites a
 * matched signal's display summary (e.g. "A new sign-in on..." → naming
 * the platform and account plainly) without changing disposition or
 * routing. The original body is never overwritten — Signal Detail always
 * shows a "Show original" toggle next to a rewritten summary.
 */
export class DirectionsPanel extends SectionPanel {
  private static current: DirectionsPanel | undefined;
  private rows: Direction[] = [];
  private selected: string | null = null;
  private drilldownLabel = "";
  private drilldownRows: SignalRow[] = [];
  private loadError: string | undefined;
  private preview: PreviewResult | undefined;
  private previewError: string | undefined;
  private previewBusy = false;

  static show(): void {
    if (DirectionsPanel.current) {
      DirectionsPanel.current.reveal();
      return;
    }
    DirectionsPanel.current = new DirectionsPanel();
  }

  private constructor() {
    super("mind.directions", "Directions — mind");
    this.load();
  }

  protected onDispose(): void {
    DirectionsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as {
      command?: string;
      id?: string;
      field?: string;
      value?: string;
    };
    if (m.command === "refresh") this.load();
    else if (m.command === "open" && m.id) {
      this.selected = m.id;
      this.drilldownLabel = "";
      this.drilldownRows = [];
      this.preview = undefined;
      this.previewError = undefined;
      this.render();
    } else if (m.command === "back") {
      this.selected = null;
      this.preview = undefined;
      this.previewError = undefined;
      this.render();
    } else if (m.command === "toggleEnabled" && m.id) {
      this.toggleEnabled(m.id);
    } else if (m.command === "commitField" && m.id && m.field && m.value !== undefined) {
      this.commitField(m.id, m.field, m.value);
    } else if (m.command === "openMarkdown" && m.id && m.field) {
      this.openMarkdownField(m.id, m.field);
    } else if (m.command === "pickPosture" && m.id) {
      this.pickEnumField(m.id, "posture", POSTURE_OPTIONS);
    } else if (m.command === "pickAutonomy" && m.id) {
      this.pickEnumField(m.id, "autonomy", AUTONOMY_OPTIONS);
    } else if (m.command === "pickScopeKind" && m.id) {
      this.pickEnumField(m.id, "scopeKind", SCOPE_KIND_OPTIONS);
    } else if (m.command === "previewDirection" && m.id) {
      this.previewDirection(m.id, false);
    } else if (m.command === "previewClassify" && m.id) {
      this.previewDirection(m.id, true);
    } else if (m.command === "drilldownSignals" && m.id) {
      this.drilldownSignals(m.id);
    } else if (m.command === "newDirection") {
      vscode.commands.executeCommand("mind.direction.new");
    } else if (m.command === "deleteDirection" && m.id) {
      this.deleteDirection(m.id);
    } else if (m.command === "openSignal" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    // A preview describes the rule as it was saved a moment ago; any edit or
    // toggle makes it stale, so it is cleared rather than left on screen.
    this.preview = undefined;
    this.previewError = undefined;
    try {
      this.rows = await apiFetch<Direction[]>("/directions");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async deleteDirection(id: string): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;
    const choice = await vscode.window.showWarningMessage(
      `Delete direction "${dir.name}"? Its YAML file is renamed to .yaml.deleted so it can be restored.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return;
    try {
      await apiFetch(`/directions/${encodeURIComponent(id)}`, { method: "DELETE" });
      this.selected = null;
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private async toggleEnabled(id: string): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;
    try {
      await apiFetch(`/directions/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !dir.enabled }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  /** Short, single-line fields committed from the inline-editable span. */
  private async commitField(id: string, field: string, rawValue: string): Promise<void> {
    const body: Record<string, unknown> = {};
    if (field === "confidenceMin") {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        vscode.window.showErrorMessage("mind: confidence must be a number between 0 and 1.");
        this.render();
        return;
      }
      body[field] = parsed;
    } else {
      body[field] = rawValue;
    }

    try {
      await apiFetch(`/directions/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  /** Enum fields (posture, autonomy, scope kind) — a QuickPick instead of free text, since only specific values are valid. */
  private async pickEnumField(
    id: string,
    field: "posture" | "autonomy" | "scopeKind",
    options: readonly string[],
  ): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;

    const picked = await vscode.window.showQuickPick(
      options.map((o) => ({ label: o, picked: o === dir[field] })),
      { placeHolder: `Current: ${dir[field]}` },
    );
    if (!picked) return;
    if (picked.label === dir[field]) return;

    try {
      await apiFetch(`/directions/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: picked.label }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  /** Markdown fields (guidance, matchPrompt, responsePrompt) open as a real editor tab named "<direction>-<field>". */
  private async openMarkdownField(id: string, field: string): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;

    const FIELD_SLUGS: Record<string, string> = {
      standard: "guidance",
      matchPrompt: "match-prompt",
      responsePrompt: "response-prompt",
      transformPrompt: "transform-prompt",
    };
    const fieldSlug = FIELD_SLUGS[field];
    if (!fieldSlug) return;

    const current = (dir[field as keyof Direction] as string | null) ?? "";
    const tabSlug = `${dir.id.replace(/\//g, "-")}-${fieldSlug}`;

    await editAsMarkdown(tabSlug, current, async (newContent) => {
      try {
        await apiFetch(`/directions/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ [field]: newContent }),
        });
        vscode.window.showInformationMessage(`mind: ${fieldSlug.replace(/-/g, " ")} updated.`);
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
        return;
      }
      this.load();
    });
  }

  /**
   * Dry run — the reviewable half of "policy is code": what would this saved
   * rule have matched? POST /directions/preview writes nothing but one
   * `direction.previewed` event. The classifier is only asked (about at most
   * ten matches) when the operator explicitly picks the second button.
   */
  private async previewDirection(id: string, classify: boolean): Promise<void> {
    this.previewBusy = true;
    this.previewError = undefined;
    this.render();
    try {
      this.preview = await apiFetch<PreviewResult>("/directions/preview", {
        method: "POST",
        body: JSON.stringify({ directionId: id, limit: 50, classify }),
      });
    } catch (err) {
      this.previewError = String(err);
    }
    this.previewBusy = false;
    this.render();
  }

  /** Renders only the preview for the Direction whose detail screen is open. */
  private renderPreview(directionId: string): string {
    if (!this.preview || this.preview.directionId !== directionId) return "";
    const view = buildPreview(this.preview);
    const rows = view.rows
      .map(
        (r) => `<tr>
          <td>${esc(r.day)}</td>
          <td>${esc(r.sender)}</td>
          <td>${esc(r.adapter)}</td>
          <td>${esc(r.disposition)}</td>
          <td>${esc(r.matched)}</td>
          <td>${r.wouldMatch ? "yes" : "no"}${r.confidence != null ? ` · ${r.confidence.toFixed(2)}` : ""}</td>
          <td>${esc(r.flags.join(" · "))}</td>
        </tr>`,
      )
      .join("");
    return `<p><strong>${esc(view.summary)}</strong></p>
      <p class="sub">${esc(view.caption)}</p>
      ${
        view.rows.length > 0
          ? `<table>
              <thead><tr><th>Received</th><th>From</th><th>Channel</th><th>Status</th><th>Matched</th><th>Would match</th><th>Notes</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
          : ""
      }`;
  }

  /** Clicking the "Signals handled" cell/count opens the matching signals below, via the same drill-down endpoint Analytics uses. */
  private async drilldownSignals(id: string): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;

    try {
      this.drilldownRows = await apiFetch<SignalRow[]>(
        `/metrics/signals?directionId=${encodeURIComponent(id)}`,
      );
      this.drilldownLabel = `${dir.name} signals (${this.drilldownRows.length})`;
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.render();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Directions",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    if (this.selected) {
      this.renderDetail(this.selected);
      return;
    }

    const rows = this.rows
      .map(
        (d) => `<tr>
          <td>${toggleSwitch(d.enabled, "toggleEnabled", { id: d.id })}</td>
          <td class="clickable" data-action="open" data-id="${esc(d.id)}">${esc(d.name)}</td>
          <td>${esc(d.posture)}</td>
          <td>${esc(d.autonomy)}</td>
          <td>${d.confidenceMin.toFixed(2)}</td>
          <td class="clickable" data-action="drilldownSignals" data-id="${esc(d.id)}">${d.signals} (${d.overrideRate != null ? (d.overrideRate * 100).toFixed(0) + "% overridden" : "no actions yet"})</td>
        </tr>`,
      )
      .join("");

    const drilldown =
      this.drilldownRows.length > 0 || this.drilldownLabel
        ? `<h2>${esc(this.drilldownLabel)}</h2>
           <table>
             <thead><tr><th>From</th><th>Channel</th><th>Status</th><th>Body</th></tr></thead>
             <tbody>
               ${this.drilldownRows
                 .map(
                   (s) => `<tr class="clickable" data-action="openSignal" data-id="${esc(s.id)}">
                     <td>${esc(s.sender)}</td>
                     <td>${esc(s.adapter)}</td>
                     <td>${esc(s.disposition)}</td>
                     <td>${esc(s.body.slice(0, 120))}</td>
                   </tr>`,
                 )
                 .join("")}
             </tbody>
           </table>`
        : "";

    const body = `
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        <button data-action="newDirection">+ New direction</button>
      </div>
      <table>
        <thead><tr><th>Enabled</th><th>Name</th><th>Posture</th><th>Autonomy</th><th>Confidence</th><th>Signals handled</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${drilldown}
    `;

    this.panel.webview.html = this.shell("Directions", body);
  }

  private renderDetail(id: string): void {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) {
      this.selected = null;
      this.render();
      return;
    }

    const body = `
      <button data-action="back">← Back to Directions</button>
      <button data-action="deleteDirection" data-id="${esc(dir.id)}">Delete direction</button>
      <h2>${esc(dir.name)}</h2>
      <table>
        <tr><th>Id</th><td>${esc(dir.id)}</td></tr>
        <tr><th>Enabled</th><td>${toggleSwitch(dir.enabled, "toggleEnabled", { id: dir.id })}</td></tr>
        <tr><th>Name</th><td>${editableField(dir.name, "commitField", { id: dir.id, field: "name" })}</td></tr>
        <tr><th>Scope kind</th><td><span class="clickable" data-action="pickScopeKind" data-id="${esc(dir.id)}">${esc(dir.scopeKind)} ✎</span></td></tr>
        <tr><th>Scope value</th><td>${editableField(dir.scopeValue, "commitField", { id: dir.id, field: "scopeValue" })}</td></tr>
        <tr><th>Posture</th><td><span class="clickable" data-action="pickPosture" data-id="${esc(dir.id)}">${esc(dir.posture)} ✎</span></td></tr>
        <tr><th>Autonomy</th><td><span class="clickable" data-action="pickAutonomy" data-id="${esc(dir.id)}">${esc(dir.autonomy)} ✎</span></td></tr>
        <tr><th>Confidence min</th><td>${editableField(dir.confidenceMin.toFixed(2), "commitField", { id: dir.id, field: "confidenceMin" })}</td></tr>
        <tr><th>Guidance</th><td>${esc(dir.standard.slice(0, 90))}${dir.standard.length > 90 ? "…" : ""} ${openInEditorLink("Open & edit", "openMarkdown", { id: dir.id, field: "standard" })}</td></tr>
        <tr><th>Match prompt</th><td>${esc((dir.matchPrompt ?? "—").slice(0, 90))} ${openInEditorLink("Open & edit", "openMarkdown", { id: dir.id, field: "matchPrompt" })}</td></tr>
        <tr><th>Response prompt</th><td>${esc((dir.responsePrompt ?? "—").slice(0, 90))} ${openInEditorLink("Open & edit", "openMarkdown", { id: dir.id, field: "responsePrompt" })}</td></tr>
        <tr><th>Transform prompt</th><td>${esc((dir.transformPrompt ?? "—").slice(0, 90))} ${openInEditorLink("Open & edit", "openMarkdown", { id: dir.id, field: "transformPrompt" })}</td></tr>
      </table>
      <h2 class="clickable" data-action="drilldownSignals" data-id="${esc(dir.id)}">Signals handled</h2>
      <p class="sub">${dir.signals} total, ${dir.absorbed} absorbed, ${dir.proposed} proposed, ${dir.discarded} discarded${dir.overrideRate != null ? ` (${(dir.overrideRate * 100).toFixed(0)}% override rate)` : ""}.</p>
      <h2>Preview</h2>
      <div class="toolbar">
        <button data-action="previewDirection" data-id="${esc(dir.id)}"${this.previewBusy ? " disabled" : ""}>Preview matches</button>
        <button data-action="previewClassify" data-id="${esc(dir.id)}"${this.previewBusy ? " disabled" : ""}>Preview with classifier</button>
      </div>
      <p class="sub">Runs the saved rule against stored signals. "Preview matches" does not call the model; "Preview with classifier" also asks it about up to ten matches. Neither sends nor writes anything except one preview event.</p>
      ${this.previewBusy ? '<p class="sub">Sampling…</p>' : ""}
      ${this.previewError ? `<p class="danger">${esc(this.previewError)}</p>` : ""}
      ${this.renderPreview(dir.id)}
      ${
        this.drilldownRows.length > 0
          ? `<table>
              <thead><tr><th>From</th><th>Channel</th><th>Status</th><th>Body</th></tr></thead>
              <tbody>
                ${this.drilldownRows
                  .map(
                    (s) => `<tr class="clickable" data-action="openSignal" data-id="${esc(s.id)}">
                      <td>${esc(s.sender)}</td>
                      <td>${esc(s.adapter)}</td>
                      <td>${esc(s.disposition)}</td>
                      <td>${esc(s.body.slice(0, 120))}</td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>`
          : ""
      }
    `;

    this.panel.webview.html = this.shell(dir.name, body);
  }
}
