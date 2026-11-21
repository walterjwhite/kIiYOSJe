/**
 * The sidebar's structure, without the vscode import so it can be tested.
 *
 * Two kinds of row: a section link, and a collapsed group for the screens that
 * answer "what did the machine do" rather than "what needs me". Model Trace
 * and System Events live behind Developer so the default path stays
 * Queue → Signals → Directions → Learnings → Analytics → Journal.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: string;
  readonly command: string;
  /** Present when the item is nested under a group. */
  readonly group?: string;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: string;
}

export type NavTopLevel =
  | { readonly kind: "item"; readonly item: NavItem }
  | { readonly kind: "group"; readonly group: NavGroup };

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "developer",
    label: "Developer",
    icon: "beaker",
  },
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "queue",
    label: "Queue",
    icon: "inbox",
    command: "mind.queue",
  },
  {
    id: "signals",
    label: "Signals",
    icon: "rss",
    command: "mind.signals",
  },
  {
    id: "directions",
    label: "Directions",
    icon: "compass",
    command: "mind.directions",
  },
  {
    id: "learnings",
    label: "Learnings",
    icon: "lightbulb",
    command: "mind.learnings",
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "graph",
    command: "mind.analytics",
  },
  {
    id: "journal",
    label: "Journal",
    icon: "book",
    command: "mind.journal",
  },
  {
    id: "systemEvents",
    label: "System Events",
    icon: "list-unordered",
    command: "mind.systemEvents",
    group: "developer",
  },
  {
    id: "modelTrace",
    label: "Model Trace",
    icon: "type-hierarchy",
    command: "mind.modelTrace",
    group: "developer",
  },
  {
    id: "devices",
    label: "Devices",
    icon: "device-desktop",
    command: "mind.devices",
  },
  {
    id: "settings",
    label: "Settings",
    icon: "gear",
    command: "mind.settings",
  },
];

const ORDER: readonly string[] = [
  "queue",
  "signals",
  "directions",
  "learnings",
  "analytics",
  "journal",
  "developer",
  "devices",
  "settings",
];

const byId = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export function navChildren(groupId: string): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === groupId);
}

/** Rows in the order the sidebar shows them: section links and one group. */
export function navTopLevel(): NavTopLevel[] {
  const rows: NavTopLevel[] = [];
  for (const id of ORDER) {
    const group = NAV_GROUPS.find((g) => g.id === id);
    if (group) {
      rows.push({ kind: "group", group });
      continue;
    }
    const item = byId.get(id);
    if (item) rows.push({ kind: "item", item });
  }
  return rows;
}
