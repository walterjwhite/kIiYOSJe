import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import {
  errorNode,
  errorTreeItem,
  isErrorNode,
  publishErrorContext,
  type ErrorNode,
} from "./error-node.js";

const VIEW_ID = "mind.journal";

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
export class JournalProvider implements vscode.TreeDataProvider<
  JournalEvent | ErrorNode
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    JournalEvent | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private failure: string | undefined;

  /** True while the last load failed, so the tree shows a retry row. */
  get hasError(): boolean {
    return this.failure !== undefined;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: JournalEvent | ErrorNode): vscode.TreeItem {
    if (isErrorNode(node)) return errorTreeItem(node);
    const event = node;
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

  async getChildren(): Promise<Array<JournalEvent | ErrorNode>> {
    try {
      const events = await apiFetch<JournalEvent[]>("/events?limit=200");
      this.setFailure(undefined);
      return events;
    } catch (err) {
      const node = errorNode(err);
      this.setFailure(node.message);
      return [node];
    }
  }

  private setFailure(message: string | undefined): void {
    this.failure = message;
    publishErrorContext(VIEW_ID, message !== undefined);
  }
}
