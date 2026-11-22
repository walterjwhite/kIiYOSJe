import { jsonToHtml } from "./json-html.js";
import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { statusIndicator } from "./status-indicator.js";
import { extractLink } from "./link-extract.js";
import { channelLabel } from "./format.js";
import { acknowledgeSignal, openLinkAction } from "./queue-actions.js";
import { QueuePanel } from "./queue-panel.js";
import { SectionPanel, esc } from "./webview-base.js";

interface Signal {
  id: string;
  adapter: string;
  account: string | null;
  threadId: string | null;
  sender: string;
  recipients: string;
  cc: string | null;
  bcc: string | null;
  kind: string;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  transformedSummary: string | null;
  receivedAt: string;
  disposition: string;
  thoughtId: string | null;
  directionId: string | null;
  signalKind: string | null;
  escalateBy: string | null;
  reviewedAt: string | null;
}

interface Direction {
  id: string;
  name: string;
  posture: string;
  autonomy: string;
  confidenceMin: number;
  enabled: boolean;
  standard: string;
  signalActions?: SignalAction[];
}

/** Mirrors SignalAction in @mind/core; the server validates it before sending. */
type SignalAction =
  | { id: string; label: string; kind: "acknowledge" }
  | { id: string; label: string; kind: "openLink"; linkPrefix: string; confirm?: string };

interface Thought {
  id: string;
  title: string;
  body: string;
  state: string;
  nextAction: string | null;
}

interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  payload: string;
}

interface JournalEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  payload: string;
}

interface ExplainResponse {
  signal: Signal;
  direction: Direction | null;
  thought: Thought | null;
  commitment: unknown;
  actions: Action[];
  events: JournalEvent[];
}

interface DirectionOption {
  id: string;
  name: string;
}

interface ThoughtOption {
  id: string;
  title: string;
  state: string;
}

interface DisplaySettings {
  showSubject: boolean;
  showCc: boolean;
  showBcc: boolean;
  preferHtmlBody: boolean;
}

/**
 * Signal Detail — opened by clicking a row in Signals. Mirrors the mockup's
 * Queue detail pane for an individual item: full body, the Direction it
 * matched, the Thought it's linked to, every action taken, the event
 * trail, and the actions actually available here (approve/discard a
 * pending action, reclassify, undo). Backed by the existing
 * GET /signals/:id/explain, built for exactly this ("why did it do that").
 */
export class SignalDetailPanel extends SectionPanel {
  private static readonly open = new Map<string, SignalDetailPanel>();
  private data: ExplainResponse | undefined;
  private displaySettings: DisplaySettings | undefined;
  private showRawBody = false;
  private showOriginal = false;
  private loadError: string | undefined;

  static show(signalId: string): void {
    const existing = SignalDetailPanel.open.get(signalId);
    if (existing) {
      existing.reveal();
      return;
    }
    SignalDetailPanel.open.set(signalId, new SignalDetailPanel(signalId));
  }

  private constructor(private readonly signalId: string) {
    super(`mind.signal.${signalId}`, "Signal — mind");
    // Flipping mind.debug re-renders open panels from the data already loaded.
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("mind.debug")) this.render();
    });
    this.load();
  }

  private readonly configListener: vscode.Disposable;

  protected onDispose(): void {
    this.configListener.dispose();
    SignalDetailPanel.open.delete(this.signalId);
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; id?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "approve" && m.id) this.approveAction(m.id);
    else if (m.command === "discard" && m.id) this.discardAction(m.id);
    else if (m.command === "reclassify") this.reclassify();
    else if (m.command === "undo") this.undo();
    else if (m.command === "linkThought") this.linkThought();
    else if (m.command === "unlinkThought") this.unlinkThought();
    else if (m.command === "markReviewed") this.markReviewed();
    else if (m.command === "clearReviewed") this.clearReviewed();
    else if (m.command === "signalAction" && m.id) this.runSignalAction(m.id);
    else if (m.command === "toggleRawBody") {
      this.showRawBody = !this.showRawBody;
      this.render();
    } else if (m.command === "toggleOriginal") {
      this.showOriginal = !this.showOriginal;
      this.render();
    }
  }

  private async load(): Promise<void> {
    try {
      const [data, displaySettings] = await Promise.all([
        apiFetch<ExplainResponse>(`/signals/${this.signalId}/explain`),
        apiFetch<DisplaySettings>("/admin/display"),
      ]);
      this.data = data;
      this.displaySettings = displaySettings;
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async approveAction(actionId: string): Promise<void> {
    try {
      await apiFetch(`/actions/${actionId}/send`, { method: "POST" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private async discardAction(actionId: string): Promise<void> {
    try {
      await apiFetch(`/actions/${actionId}/discard`, { method: "POST" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private async reclassify(): Promise<void> {
    let dirs: DirectionOption[];
    try {
      dirs = await apiFetch<DirectionOption[]>("/directions");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }

    const picked = await vscode.window.showQuickPick(
      dirs.map((d) => ({ label: d.name, description: d.id, id: d.id })),
      { placeHolder: "Move this signal to which direction?" },
    );
    if (!picked) return;

    const reason = await vscode.window.showInputBox({
      prompt: "Why was the original match wrong? (optional)",
    });

    try {
      await apiFetch(`/signals/${this.signalId}`, {
        method: "PATCH",
        body: JSON.stringify({ directionId: picked.id, reason: reason || undefined }),
      });
      vscode.window.showInformationMessage(`mind: reclassified to ${picked.label}.`);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  private async undo(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "Undo this signal's disposition? Any proposed actions are discarded.",
      { modal: true },
      "Undo",
    );
    if (confirmed !== "Undo") return;

    try {
      await apiFetch(`/signals/${this.signalId}/undo`, { method: "POST" });
      vscode.window.showInformationMessage("mind: signal undone.");
    } catch (err) {
      // A 409 here means "already sent, cannot undo" — a real outcome the
      // operator should notice, not a server failure, so flag it yellow
      // rather than leaving the indicator on the red error it'd otherwise
      // settle to.
      if (String(err).includes("409")) {
        statusIndicator.warn();
      }
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  private async linkThought(): Promise<void> {
    const dirs = await this.fetchThoughtOptions();
    if (dirs === undefined) return;

    const items: Array<{ label: string; description?: string; isNew?: boolean }> = [
      ...dirs.map((t) => ({ label: t.title, description: `${t.state} · ${t.id}` })),
      { label: "+ Create a new thought from a title…", isNew: true },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Link this signal to which thought?",
    });
    if (!picked) return;

    if (picked.isNew) {
      const title = await vscode.window.showInputBox({
        prompt: "New thought title",
        placeHolder: "What is this really about?",
      });
      if (!title) return;
      await this.putThoughtLink({ title });
      return;
    }

    const match = dirs.find((t) => t.title === picked.label);
    if (!match) return;
    await this.putThoughtLink({ thoughtId: match.id });
  }

  private async fetchThoughtOptions(): Promise<ThoughtOption[] | undefined> {
    try {
      return await apiFetch<ThoughtOption[]>("/thoughts");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return undefined;
    }
  }

  private async putThoughtLink(body: { thoughtId: string } | { title: string }): Promise<void> {
    try {
      await apiFetch(`/signals/${this.signalId}/thought`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      vscode.window.showInformationMessage("mind: linked to thought.");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  private async unlinkThought(): Promise<void> {
    try {
      await apiFetch(`/signals/${this.signalId}/thought`, { method: "DELETE" });
      vscode.window.showInformationMessage("mind: unlinked from thought.");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  /** For signals that never had an action to approve or discard — information/acknowledgement signals with nothing to send. */
  private async markReviewed(): Promise<void> {
    try {
      await apiFetch(`/signals/${this.signalId}/reviewed`, { method: "PUT" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  /** Runs a button declared in the matched direction's `signalActions`. */
  private async runSignalAction(actionId: string): Promise<void> {
    // Look the action up from loaded data rather than trusting the webview
    // message for anything but the id.
    const action = this.data?.direction?.signalActions?.find((x) => x.id === actionId);
    if (!action) return;
    if (action.kind === "acknowledge") await this.acknowledge();
    else if (action.kind === "openLink") await this.openLink(action);
  }

  /** Acknowledge: reviewed, thought closed, any proposed reply dismissed. One server call. */
  private async acknowledge(): Promise<void> {
    try {
      await acknowledgeSignal(this.signalId);
      QueuePanel.refreshIfOpen();
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private async openLink(action: Extract<SignalAction, { kind: "openLink" }>): Promise<void> {
    const signal = this.data?.signal;
    if (!signal) return;
    await openLinkAction(action, signal.htmlBody, signal.body);
  }

  private async clearReviewed(): Promise<void> {
    try {
      await apiFetch(`/signals/${this.signalId}/reviewed`, { method: "DELETE" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Signal",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const d = this.data;
    if (!d) return;
    const { signal, direction, thought, actions, events } = d;
    const ds = this.displaySettings ?? {
      showSubject: true,
      showCc: true,
      showBcc: true,
      preferHtmlBody: true,
    };

    const debug = vscode.workspace.getConfiguration("mind").get<boolean>("debug") ?? false;

    const cc: string[] = signal.cc ? safeParseArray(signal.cc) : [];
    const bcc: string[] = signal.bcc ? safeParseArray(signal.bcc) : [];
    const hasHtml = Boolean(signal.htmlBody);
    // Declared buttons. An openLink button only appears when its link is
    // actually in the message; acknowledge hides once the signal is reviewed.
    const signalActionButtons = (direction?.signalActions ?? [])
      .filter((a) =>
        a.kind === "openLink"
          ? extractLink(signal.htmlBody, signal.body, a.linkPrefix) !== undefined
          : !signal.reviewedAt,
      )
      .map(
        (a) => `<button data-action="signalAction" data-id="${esc(a.id)}">${esc(a.label)}</button>`,
      );
    if (
      signal.reviewedAt &&
      (direction?.signalActions ?? []).some((a) => a.kind === "acknowledge")
    ) {
      signalActionButtons.unshift(
        `<span class="badge">acknowledged ${esc(signal.reviewedAt)}</span>`,
      );
    }
    const showingHtml = ds.preferHtmlBody && hasHtml && !this.showRawBody;

    const actionRows = actions
      .map((a) => {
        let preview = "";
        try {
          preview = (JSON.parse(a.payload) as { body?: string }).body?.slice(0, 200) ?? "";
        } catch {
          /* show the kind instead */
        }
        const buttons =
          a.status === "proposed"
            ? `<button data-action="approve" data-id="${esc(a.id)}">✓ Approve &amp; send</button>
               <button data-action="discard" data-id="${esc(a.id)}">✕ Discard</button>`
            : `<span class="badge">${esc(a.status)}</span>`;
        return `<div class="card">
          <div><span class="badge">${esc(a.kind)}</span> via ${esc(a.adapter)}</div>
          <div class="sub">${esc(preview || "(no body)")}</div>
          <div class="toolbar" style="margin-top: 6px; margin-bottom: 0;">${buttons}</div>
        </div>`;
      })
      .join("");

    // The event trail is useful only if it reads as "what happened, and
    // why" rather than a bare kind/actor/time row. signal.processed
    // already carries the AI's reasoning (confidence, intent, urgency,
    // answerable, matchedBy, reason) — surface that directly instead of
    // leaving the operator to open the raw JSON.
    const eventRows = events
      .map((e) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(e.payload);
        } catch {
          /* unparsable payload, fall through to the kind-only row */
        }
        return `<div class="card event-card">
          <div class="toolbar" style="margin-bottom: 4px;">
            <span class="badge">${esc(e.kind)}</span>
            <span class="meta">${esc(e.at)} · ${esc(e.actor)}</span>
          </div>
          ${renderEventDetail(e.kind, payload)}
          ${e.kind === "signal.processed" ? renderModelCalls(payload) : ""}
          ${debug ? renderDebugDetail(e, payload) : ""}
        </div>`;
      })
      .join("");

    const body = `
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        <button data-action="reclassify">Reclassify</button>
        ${signal.disposition !== "new" ? '<button data-action="undo">Undo</button>' : ""}
        ${
          thought
            ? `<button data-action="unlinkThought">Unlink from thought</button>`
            : `<button data-action="linkThought">Link to a thought…</button>`
        }
      </div>

      ${signalActionButtons.length > 0 ? `<div class="toolbar">${signalActionButtons.join("")}</div>` : ""}

      <table>
        <tr><th>From</th><td>${esc(signal.sender)}</td></tr>
        ${ds.showSubject && signal.subject ? `<tr><th>Subject</th><td>${esc(signal.subject)}</td></tr>` : ""}
        ${ds.showCc && cc.length > 0 ? `<tr><th>Cc</th><td>${esc(cc.join(", "))}</td></tr>` : ""}
        ${ds.showBcc && bcc.length > 0 ? `<tr><th>Bcc</th><td>${esc(bcc.join(", "))}</td></tr>` : ""}
        <tr><th>Channel</th><td>${esc(channelLabel(signal.adapter, signal.account))}</td></tr>
        <tr><th>First received</th><td>${esc(signal.receivedAt)}</td></tr>
        <tr><th>Status</th><td><span class="badge">${esc(signal.disposition)}</span></td></tr>
        <tr><th>Kind</th><td>${esc(signal.signalKind ?? "—")}</td></tr>
        <tr><th>Escalate by</th><td>${esc(signal.escalateBy ?? "—")}</td></tr>
      </table>

      <h2>Body</h2>
      ${
        signal.transformedSummary
          ? `<div class="card insight-card">
               <div class="meta">Rewritten summary</div>
               <div>${esc(signal.transformedSummary)}</div>
             </div>
             <div class="toolbar">
               <button data-action="toggleOriginal">${this.showOriginal ? "Hide" : "Show"} original body${signal.subject ? " and subject" : ""}</button>
             </div>`
          : ""
      }
      ${
        !signal.transformedSummary || this.showOriginal
          ? `${
              hasHtml
                ? `<div class="toolbar">
                     <button data-action="toggleRawBody">${showingHtml ? "Show plain text" : "Show original HTML"}</button>
                   </div>`
                : ""
            }
            ${
              showingHtml
                ? `<iframe class="html-body-frame" sandbox="" srcdoc="${esc(signal.htmlBody ?? "")}"></iframe>`
                : `<p class="card">${esc(signal.body)}</p>`
            }`
          : ""
      }

      <h2>Matched direction</h2>
      ${
        direction
          ? `<table>
              <tr><th>Name</th><td>${esc(direction.name)}</td></tr>
              <tr><th>Posture</th><td>${esc(direction.posture)}</td></tr>
              <tr><th>Autonomy</th><td>${esc(direction.autonomy)}</td></tr>
              <tr><th>Guidance</th><td>${esc(direction.standard)}</td></tr>
            </table>`
          : '<p class="empty">No direction matched.</p>'
      }

      <h2>Linked thought</h2>
      ${
        thought
          ? `<table>
              <tr><th>Title</th><td>${esc(thought.title)}</td></tr>
              <tr><th>State</th><td>${esc(thought.state)}</td></tr>
              <tr><th>Next action</th><td>${esc(thought.nextAction ?? "—")}</td></tr>
            </table>`
          : '<p class="empty">Not linked to a thought.</p>'
      }

      <h2>Actions (${actions.length})</h2>
      ${
        actions.length > 0
          ? actionRows
          : `<div class="card">
              <div><strong>No response needed.</strong> ${esc(describeNoActionReason(signal))}</div>
              <div class="toolbar" style="margin-top: 8px; margin-bottom: 0;">
                ${
                  signal.reviewedAt
                    ? `<span class="badge">reviewed ${esc(signal.reviewedAt)}</span>
                       <button data-action="clearReviewed">Clear reviewed</button>`
                    : `<button data-action="markReviewed">✓ Mark reviewed</button>`
                }
              </div>
            </div>`
      }

      <h2>How it was processed</h2>
      ${debug ? '<p class="sub">Debug mode is on (setting <code>mind.debug</code>).</p>' : ""}
      ${eventRows || '<p class="empty">No events recorded.</p>'}
    `;

    this.panel.webview.html = this.shell(this.tabTitle(signal), body);
  }

  /** The tab title carries enough to tell signals apart without opening them: subject (if any), sender, channel, and roughly when. */
  private tabTitle(signal: Signal): string {
    const when = signal.receivedAt.slice(0, 16).replace("T", " ");
    const channel = channelLabel(signal.adapter, signal.account);
    const subjectPart = signal.subject ? `${signal.subject} — ` : "";
    return `${subjectPart}${signal.sender} — ${channel} — ${when}`;
  }
}

function safeParseArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function describeNoActionReason(signal: Signal): string {
  switch (signal.disposition) {
    case "filed":
      return "Classified as information or an acknowledgement — nothing was expected in return.";
    case "promoted":
      return "Surfaced as a Thought for your judgement, but doesn't call for an outbound reply.";
    case "escalated":
      return "Escalated to you directly rather than drafted — see the linked thought for why.";
    case "absorbed":
      return "Absorbed without a reply, or its draft was already resolved.";
    default:
      return "Not yet processed.";
  }
}

export function renderEventDetail(kind: string, payload: Record<string, unknown>): string {
  // signal.processed carries the actual AI reasoning: confidence, intent,
  // urgency, whether it judged itself able to answer, and why it landed
  // where it did. This is the one that answers "how did AI process this".
  if (kind === "signal.processed") {
    const parts: string[] = [];
    if (payload["reason"]) parts.push(`<strong>Reason:</strong> ${esc(String(payload["reason"]))}`);
    if (payload["intent"]) parts.push(`<strong>Intent:</strong> ${esc(String(payload["intent"]))}`);
    if (payload["matchedBy"])
      parts.push(`<strong>Matched by:</strong> ${esc(String(payload["matchedBy"]))}`);
    if (payload["confidence"] !== undefined) {
      parts.push(`<strong>Confidence:</strong> ${esc(String(payload["confidence"]))}`);
    }
    if (payload["urgency"])
      parts.push(`<strong>Urgency:</strong> ${esc(String(payload["urgency"]))}`);
    if (payload["answerable"] !== undefined) {
      parts.push(`<strong>Answerable by AI:</strong> ${payload["answerable"] ? "yes" : "no"}`);
    }
    if (payload["answerBlocker"]) {
      parts.push(`<strong>Blocker:</strong> ${esc(String(payload["answerBlocker"]))}`);
    }
    if (
      Array.isArray(payload["sensitiveTopics"]) &&
      (payload["sensitiveTopics"] as unknown[]).length > 0
    ) {
      parts.push(
        `<strong>Sensitive topics:</strong> ${esc((payload["sensitiveTopics"] as string[]).join(", "))}`,
      );
    }
    return parts.length > 0
      ? `<div>${parts.join("<br/>")}</div>`
      : '<div class="sub">No detail recorded.</div>';
  }

  if (kind === "action.sent" || kind === "action.failed" || kind === "action.discarded") {
    const parts: string[] = [];
    if (payload["autonomous"] !== undefined) {
      parts.push(
        `<strong>Sent automatically:</strong> ${payload["autonomous"] ? "yes" : "no, approved by you"}`,
      );
    }
    if (payload["error"]) parts.push(`<strong>Error:</strong> ${esc(String(payload["error"]))}`);
    return parts.length > 0 ? `<div>${parts.join("<br/>")}</div>` : "";
  }

  if (kind === "signal.reclassified") {
    return `<div><strong>Moved:</strong> ${esc(String(payload["fromDirectionId"] ?? "—"))} → ${esc(String(payload["toDirectionId"] ?? "—"))}${payload["reason"] ? `<br/><strong>Reason:</strong> ${esc(String(payload["reason"]))}` : ""}</div>`;
  }

  // Fall back to a compact raw view for kinds without a dedicated renderer,
  // so nothing is hidden — just not specially formatted yet.
  const raw = JSON.stringify(payload);
  return raw === "{}" ? "" : `<div class="meta">${esc(raw.slice(0, 300))}</div>`;
}

interface AiCallTrace {
  operation?: string;
  provider?: string;
  model?: string;
  transport?: string;
  endpoint?: string | null;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  promptChars?: number;
  responseChars?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface AiTrace {
  configured?: boolean;
  calls?: AiCallTrace[];
  skipped?: Record<string, string>;
  modelMs?: number;
  totalMs?: number;
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

/**
 * Which model calls were made for a processed signal (provider, model,
 * endpoint, duration, tokens), or why a step made none. Shown always, because
 * it is the answer to "what did the model do for this signal?", the same data
 * the Model Trace screen is built from. Contains no message text.
 */
function renderModelCalls(payload: Record<string, unknown>): string {
  const ai = payload["ai"] as AiTrace | undefined;
  if (!ai) {
    return `<div class="sub">No model trace on this event. It was processed before tracing was added, or by a build without it.</div>`;
  }
  const rows: string[] = [];
  const calls = ai.calls ?? [];
  rows.push(`<tr><th>Total processing time</th><td>${esc(fmtMs(ai.totalMs))}</td></tr>`);
  rows.push(`<tr><th>Time in model calls</th><td>${esc(fmtMs(ai.modelMs))}</td></tr>`);
  if (calls.length === 0) {
    rows.push(
      `<tr><th>Model calls</th><td><strong>none</strong>${ai.configured ? "" : " (no AI provider configured)"}. No model was contacted for this signal.</td></tr>`,
    );
  }
  calls.forEach((c, i) => {
    const where =
      c.transport === "acp"
        ? `ACP agent (${c.provider ?? "?"})`
        : `${c.provider ?? "?"} at ${c.endpoint ?? "?"}`;
    const tokens =
      c.inputTokens !== undefined || c.outputTokens !== undefined
        ? ` · tokens in/out: ${c.inputTokens ?? "?"}/${c.outputTokens ?? "?"}`
        : "";
    rows.push(
      `<tr><th>Call ${i + 1}: ${esc(c.operation ?? "?")}</th><td>
        ${c.ok ? "ok" : '<span class="danger">failed</span>'} · ${esc(fmtMs(c.durationMs))}<br/>
        model <code>${esc(c.model ?? "?")}</code> via ${esc(where)}<br/>
        prompt ${esc(String(c.promptChars ?? "?"))} chars → response ${esc(String(c.responseChars ?? "?"))} chars${esc(tokens)}
        ${c.error ? `<br/><span class="danger">${esc(c.error)}</span>` : ""}
      </td></tr>`,
    );
  });
  for (const [step, why] of Object.entries(ai.skipped ?? {})) {
    rows.push(`<tr><th>Skipped: ${esc(step)}</th><td>${esc(why)}</td></tr>`);
  }
  return `<table class="debug">${rows.join("")}</table>`;
}

/**
 * Extra detail shown only when mind.debug is on: the event id and the raw
 * payload. The model calls are shown without debug (renderModelCalls).
 */
function renderDebugDetail(e: JournalEvent, payload: Record<string, unknown>): string {
  const rows: string[] = [];
  rows.push(`<tr><th>Event id</th><td><code>${esc(e.id)}</code></td></tr>`);

  return `<table class="debug">${rows.join("")}</table>
    <details><summary class="meta">Raw event payload</summary><pre class="json">${jsonToHtml(payload, 2)}</pre></details>`;
}
