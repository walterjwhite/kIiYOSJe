import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

export interface JournalEvent {
  id: string;
  at: string;
  actor: string;
  kind: string;
  payload: string;
}

/**
 * Read-only tree view over GET /events — the append-only audit log
 * (PLAN.md §Foundations 5). Nothing here is editable; this is a window
 * onto the same table every decision already writes to, not a separate
 * log the way the mockup briefly considered before folding History into
 * Signals.
 */
export class JournalProvider implements vscode.TreeDataProvider<JournalEvent> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    JournalEvent | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(event: JournalEvent): vscode.TreeItem {
    const item = new vscode.TreeItem(
      event.kind,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${event.actor} · ${event.at}`;
    let detail = "";
    try {
      detail = JSON.stringify(JSON.parse(event.payload), null, 2);
    } catch {
      detail = event.payload;
    }
    item.tooltip = detail;
    item.contextValue = "journalEvent";
    return item;
  }

  async getChildren(): Promise<JournalEvent[]> {
    try {
      return await apiFetch<JournalEvent[]>("/events?limit=200");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return [];
    }
  }
}
