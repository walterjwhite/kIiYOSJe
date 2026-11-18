import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import {
  errorNode,
  errorTreeItem,
  isErrorNode,
  publishErrorContext,
  type ErrorNode,
} from "./error-node.js";

const VIEW_ID = "mind.thoughts";

export interface Thought {
  id: string;
  title: string;
  body: string;
  state: string;
  directionId: string | null;
  nextAction: string | null;
  reviewAt: string | null;
  escalateBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ThoughtsProvider implements vscode.TreeDataProvider<
  Thought | ErrorNode
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Thought | undefined | void
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

  getTreeItem(node: Thought | ErrorNode): vscode.TreeItem {
    if (isErrorNode(node)) return errorTreeItem(node);
    const thought = node;
    const item = new vscode.TreeItem(
      thought.title,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = thought.state;
    item.tooltip = thought.nextAction ?? undefined;
    item.contextValue = "thought";
    item.command = {
      command: "mind.thought.open",
      title: "Open thought",
      arguments: [thought],
    };
    return item;
  }

  async getChildren(): Promise<Array<Thought | ErrorNode>> {
    try {
      const all = await apiFetch<Thought[]>("/thoughts");
      // active first, then seedling; closed/parked at end
      const order: Record<string, number> = {
        active: 0,
        seedling: 1,
        parked: 2,
        closed: 3,
      };
      all.sort(
        (left, right) =>
          (order[left.state] ?? 9) - (order[right.state] ?? 9),
      );
      this.setFailure(undefined);
      return all;
    } catch (err) {
      // Surface the failure inside the tree so it cannot be mistaken for the
      // calm empty state, and keep the extension notification-free.
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
