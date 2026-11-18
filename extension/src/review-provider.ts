import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import {
  errorNode,
  errorTreeItem,
  isErrorNode,
  publishErrorContext,
  type ErrorNode,
} from "./error-node.js";

const VIEW_ID = "mind.review";

export interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  payload: string;
  signalId: string | null;
}

export class ReviewProvider implements vscode.TreeDataProvider<
  Action | ErrorNode
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Action | undefined | void
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

  getTreeItem(node: Action | ErrorNode): vscode.TreeItem {
    if (isErrorNode(node)) return errorTreeItem(node);
    const action = node;
    let preview = "";
    try {
      const payload = JSON.parse(action.payload) as { body?: string };
      preview = payload.body?.replace(/\s+/g, " ").trim().slice(0, 60) ?? "";
    } catch {
      // A malformed payload still needs a label.
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

  async getChildren(): Promise<Array<Action | ErrorNode>> {
    try {
      const actions = await apiFetch<Action[]>("/actions?status=proposed");
      this.setFailure(undefined);
      return actions;
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
