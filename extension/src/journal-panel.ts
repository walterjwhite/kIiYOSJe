import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { SectionPanel, esc } from "./webview-base.js";

interface JournalEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  payload: string;
}

/**
 * Journal — the operator's own dated, free-text notes (POST /events/notes,
 * kind='journal.note') — never generated, never tied to a signal,
 * direction, or thought, just something written down for later. System
 * activity lives in its own System Events screen now, so this is just
 * your entries, not a mix of the two.
 */
export class JournalPanel extends SectionPanel {
  private static current: JournalPanel | undefined;
  private notes: JournalEvent[] = [];
  private loadError: string | undefined;

  static show(): void {
    if (JournalPanel.current) {
      JournalPanel.current.reveal();
      return;
    }
    JournalPanel.current = new JournalPanel();
  }

  private constructor() {
    super("mind.journal", "Journal — mind");
    this.load();
  }

  protected onDispose(): void {
    JournalPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; text?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "addNote" && m.text) this.addNote(m.text);
  }

  private async load(): Promise<void> {
    try {
      this.notes = await apiFetch<JournalEvent[]>("/events?kind=journal.note&limit=200");
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async addNote(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await apiFetch("/events/notes", {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
    this.load();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Journal",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const noteCards = this.notes
      .map(
        (n) => `<div class="card note-card">
          <div class="meta">${esc(n.at)}</div>
          <div>${esc(parseNoteText(n.payload))}</div>
        </div>`,
      )
      .join("");

    const body = `
      <p class="sub">Dated automatically, append-only, not tied to any signal or direction — just something worth writing down. System activity lives in its own <strong>System Events</strong> screen.</p>
      <div class="toolbar">
        <textarea id="note-input" rows="3" style="flex: 1; min-width: 260px; font-family: var(--vscode-font-family); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--vscode-widget-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); resize: vertical;" placeholder="What's worth remembering?"></textarea>
      </div>
      <div class="toolbar">
        <button data-action="addNote" data-value-from="#note-input">+ Add note</button>
        <button data-action="refresh">↺ Refresh</button>
      </div>

      <h2>Notes (${this.notes.length})</h2>
      ${noteCards || '<p class="empty">No notes yet — write one above.</p>'}
    `;

    this.panel.webview.html = this.shell(
      "Journal",
      body,
      `.note-card { border-left-color: var(--mind-accent); }`,
    );
  }
}

function parseNoteText(payload: string): string {
  try {
    return (JSON.parse(payload) as { text?: string }).text ?? payload;
  } catch {
    return payload;
  }
}
