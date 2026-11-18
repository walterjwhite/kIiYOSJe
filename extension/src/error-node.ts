/**
 * Placeholder row rendered in place of an empty tree when the mind server
 * cannot be reached. Without it a failed request and a genuinely empty list
 * both look like nothing at all, which hides the real problem.
 */

import * as vscode from "vscode";

export interface ErrorNode {
  kind: "error";
  message: string;
}

export function errorNode(err: unknown): ErrorNode {
  return {
    kind: "error",
    message: err instanceof Error ? err.message : String(err),
  };
}

export function isErrorNode(node: unknown): node is ErrorNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as ErrorNode).kind === "error"
  );
}

/**
 * Mirror a tree's failure state into a context key (`mind.thoughts.error`) so
 * the view-title retry button is only contributed while the tree is stuck.
 * Resolves to nothing; failures here must never affect the tree itself.
 */
export function publishErrorContext(viewId: string, failed: boolean): void {
  void vscode.commands.executeCommand("setContext", `${viewId}.error`, failed);
}

export function errorTreeItem(node: ErrorNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "Can't reach the mind server",
    vscode.TreeItemCollapsibleState.None,
  );
  item.description = "click to retry";
  item.tooltip = node.message;
  item.iconPath = new vscode.ThemeIcon("warning");
  item.contextValue = "mindError";
  item.command = { command: "mind.refresh", title: "Retry" };
  return item;
}
