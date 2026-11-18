import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { SectionPanel, esc } from "./webview-base.js";

interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  account: string | null;
  payload: string;
  signalId: string | null;
  thoughtId: string | null;
}

/**
 * Queue — the mockup's list+detail Queue tab. Proposed actions awaiting
 * approval; approve/discard is the only place a send is authorized
 * (PLAN §10). This replaces the earlier Review tree view: same data
 * (GET /actions?status=proposed), but shown only once this panel is
 * opened, not sitting in the sidebar at all times.
 */
export class QueuePanel extends SectionPanel {
  private static current: QueuePanel | undefined;
  private actions: Action[] = [];
  private loadError: string | undefined;

  static show(): void {
    if (QueuePanel.current) {
      QueuePanel.current.reveal();
      return;
    }
    QueuePanel.current = new QueuePanel();
  }

  private constructor() {
    super("mind.queue", "Queue — mind");
    this.load();
  }

  protected onDispose(): void {
    QueuePanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; id?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "approve" && m.id) this.approve(m.id);
    else if (m.command === "discard" && m.id) this.discard(m.id);
    else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      this.actions = await apiFetch<Action[]>("/actions?status=proposed");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async approve(id: string): Promise<void> {
    try {
      await apiFetch(`/actions/${id}/send`, { method: "POST" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private async discard(id: string): Promise<void> {
    try {
      await apiFetch(`/actions/${id}/discard`, { method: "POST" });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
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

    const rows = this.actions
      .map((a) => {
        let preview = "";
        try {
          const payload = JSON.parse(a.payload) as { body?: string };
          preview = payload.body?.replace(/\s+/g, " ").trim().slice(0, 140) ?? "";
        } catch {
          /* malformed payload still gets a row */
        }
        return `<div class="card">
          <div class="toolbar" style="justify-content: space-between; margin-bottom: 4px;">
            <span><span class="badge">${esc(a.adapter)}</span> ${esc(a.account ?? "")}</span>
          </div>
          <div>${esc(preview || a.kind)}</div>
          <div class="toolbar" style="margin-top: 8px; margin-bottom: 0;">
            <button data-action="approve" data-id="${esc(a.id)}">✓ Approve &amp; send</button>
            <button data-action="discard" data-id="${esc(a.id)}">✕ Discard</button>
            ${a.signalId ? `<button data-action="open" data-id="${esc(a.signalId)}">View signal</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    const body = `
      <div class="toolbar">
        <button data-action="refresh">↺ Refresh</button>
        <span class="meta">${this.actions.length} awaiting approval</span>
      </div>
      ${rows || '<p class="empty">Nothing is awaiting your approval.</p>'}
    `;

    this.panel.webview.html = this.shell("Queue", body);
  }
}
