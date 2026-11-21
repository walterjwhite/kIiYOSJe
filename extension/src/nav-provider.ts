import * as vscode from "vscode";
import { NAV_GROUPS, type NavGroup, type NavItem, navChildren, navTopLevel } from "./nav-items.js";

/**
 * The sidebar is a short list of buttons (Queue, Signals, Directions,
 * Learnings, Analytics, Journal, Devices, Settings) plus one collapsed
 * Developer group for System Events and Model Trace — nothing else. Each
 * click opens that section as its own webview panel in the editor area,
 * where the full detail lives.
 *
 * This replaces the earlier design, where Thoughts/Review/Signals/Journal
 * each dumped their live data straight into the sidebar as trees. That
 * put a lot of information in front of the operator before they asked for
 * it, which cuts against the point of this tool: reduce what a person has
 * to look at, not add another dense panel. A sidebar of plain links, with
 * detail arriving only once a section is opened, matches the mockup and
 * matches "help the operator focus" more literally than a tree ever did.
 *
 * Model Trace and System Events answer "what did the machine do", not
 * "what needs me", so they sit behind the collapsed Developer group rather
 * than on the default path. The structure itself lives in nav-items.ts so
 * it can be tested without vscode.
 */
export type NavNode =
  | { readonly kind: "item"; readonly item: NavItem }
  | { readonly kind: "group"; readonly group: NavGroup };

export class NavProvider implements vscode.TreeDataProvider<NavNode> {
  getTreeItem(node: NavNode): vscode.TreeItem {
    if (node.kind === "group") {
      const treeItem = new vscode.TreeItem(
        node.group.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      treeItem.id = node.group.id;
      if (node.group.description !== undefined) treeItem.description = node.group.description;
      treeItem.iconPath = new vscode.ThemeIcon(node.group.icon);
      treeItem.contextValue = "navGroup";
      return treeItem;
    }

    const { item } = node;
    const treeItem = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    treeItem.id = item.id;
    if (item.description !== undefined) treeItem.description = item.description;
    treeItem.iconPath = new vscode.ThemeIcon(item.icon);
    treeItem.command = { command: item.command, title: item.label };
    treeItem.contextValue = "navItem";
    return treeItem;
  }

  getChildren(node?: NavNode): NavNode[] {
    if (!node) return navTopLevel().map((row) => row);
    if (node.kind === "group") {
      return navChildren(node.group.id).map((item) => ({ kind: "item", item }));
    }
    return [];
  }
}

/** Exported for tests that need the group ids without importing vscode. */
export const NAV_GROUP_IDS = NAV_GROUPS.map((g) => g.id);
