import * as vscode from "vscode";

/**
 * The sidebar is a short list of buttons, one per screen (Queue, Today,
 * Signals, Directions, Learnings, Analytics, Journal, System Events,
 * Devices) — nothing else. Each click opens that section as its own
 * webview panel in the editor area, where the full detail lives.
 *
 * This replaces the earlier design, where Thoughts/Review/Signals/Journal
 * each dumped their live data straight into the sidebar as trees. That
 * put a lot of information in front of the operator before they asked for
 * it, which cuts against the point of this tool: reduce what a person has
 * to look at, not add another dense panel. A sidebar of plain links, with
 * detail arriving only once a section is opened, matches the mockup and
 * matches "help the operator focus" more literally than a tree ever did.
 */
export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: string;
  readonly command: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "queue",
    label: "Queue",
    description: "plan and work through what needs action",
    icon: "inbox",
    command: "mind.queue",
  },
  {
    id: "today",
    label: "Today",
    description: "the daily brief",
    icon: "calendar",
    command: "mind.brief",
  },
  {
    id: "signals",
    label: "Signals",
    description: "every signal, in and out",
    icon: "rss",
    command: "mind.signals",
  },
  {
    id: "directions",
    label: "Directions",
    description: "the rules mind matches against",
    icon: "compass",
    command: "mind.directions",
  },
  {
    id: "learnings",
    label: "Learnings",
    description: "policy proposals and reclassifications",
    icon: "lightbulb",
    command: "mind.learnings",
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "volume, overrides, time saved",
    icon: "graph",
    command: "mind.analytics",
  },
  {
    id: "journal",
    label: "Journal",
    description: "your own dated notes",
    icon: "book",
    command: "mind.journal",
  },
  {
    id: "systemEvents",
    label: "System Events",
    description: "what mind itself did, with the same filters as Signals",
    icon: "list-unordered",
    command: "mind.systemEvents",
  },
  {
    id: "devices",
    label: "Devices",
    description: "paired clients (preview)",
    icon: "device-desktop",
    command: "mind.devices",
  },
  {
    id: "settings",
    label: "Settings",
    description: "which signal fields are shown",
    icon: "gear",
    command: "mind.settings",
  },
];

export class NavProvider implements vscode.TreeDataProvider<NavItem> {
  getTreeItem(item: NavItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      item.label,
      vscode.TreeItemCollapsibleState.None,
    );
    if (item.description !== undefined) treeItem.description = item.description;
    treeItem.iconPath = new vscode.ThemeIcon(item.icon);
    treeItem.command = { command: item.command, title: item.label };
    treeItem.contextValue = "navItem";
    return treeItem;
  }

  getChildren(): NavItem[] {
    return [...NAV_ITEMS];
  }
}
