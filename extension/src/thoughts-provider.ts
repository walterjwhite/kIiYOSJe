import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

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

export class ThoughtsProvider implements vscode.TreeDataProvider<Thought> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Thought | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(thought: Thought): vscode.TreeItem {
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

  async getChildren(): Promise<Thought[]> {
    try {
      const all = await apiFetch<Thought[]>("/thoughts");
      // active first, then seedling; closed/parked at end
      return all.sort((a, b) => {
        const order: Record<string, number> = {
          active: 0,
          seedling: 1,
          parked: 2,
          closed: 3,
        };
        return (order[a.state] ?? 9) - (order[b.state] ?? 9);
      });
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return [];
    }
  }
}
