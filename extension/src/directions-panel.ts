import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { editAsMarkdown } from "./markdown-editor.js";
import { SectionPanel, esc, toggleSwitch, editableField, openInEditorLink } from "./webview-base.js";

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
      this.render();
    } else if (m.command === "back") {
      this.selected = null;
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
    } else if (m.command === "drilldownSignals" && m.id) {
      this.drilldownSignals(m.id);
    } else if (m.command === "openSignal" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      this.rows = await apiFetch<Direction[]>("/directions");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async toggleEnabled(id: string): Promise<void> {
    const dir = this.rows.find((d) => d.id === id);
    if (!dir) return;
    try {
      await apiFetch(`/directions/${id}`, {
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
      await apiFetch(`/directions/${id}`, { method: "PUT", body: JSON.stringify(body) });
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
      await apiFetch(`/directions/${id}`, {
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
        await apiFetch(`/directions/${id}`, {
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
      <p class="sub">Each direction decides how a category of signal is handled. Click a name to open its
      detail screen; flip the switch to enable or disable; click the signals-handled count for the signals
      behind it. New directions are authored as YAML under <code>directions/</code>
      (<strong>mind: Edit Directions</strong>) — this table edits an existing one's fields directly.</p>
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
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
      <h2 class="clickable" data-action="drilldownSignals" data-id="${esc(dir.id)}">Signals handled — click to view</h2>
      <p class="sub">${dir.signals} total, ${dir.absorbed} absorbed, ${dir.proposed} proposed, ${dir.discarded} discarded${dir.overrideRate != null ? ` (${(dir.overrideRate * 100).toFixed(0)}% override rate)` : ""}.</p>
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
