import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

// Displayed in the sidebar as "Queue" (package.json views) — this is the
// review queue PLAN.md §10 describes: proposed actions awaiting approval.
// The view id (mind.review) is unchanged from before the rename; only the
// label shown to the user changed.
interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  payload: string;
  signalId: string | null;
}

export class ReviewProvider implements vscode.TreeDataProvider<Action> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Action | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(action: Action): vscode.TreeItem {
    let preview = "";
    try {
      const payload = JSON.parse(action.payload) as { body?: string; to?: string[] };
      preview = payload.body?.slice(0, 60) ?? "";
    } catch {
      /* ignore */
    }

    const item = new vscode.TreeItem(
      `[${action.adapter}] ${preview || action.kind}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = action.status;
    item.contextValue = "action";
    // Store id for command handlers
    (item as vscode.TreeItem & { actionId: string }).actionId = action.id;
    return item;
  }

  async getChildren(): Promise<Action[]> {
    try {
      return await apiFetch<Action[]>("/actions?status=proposed");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return [];
    }
  }
}
