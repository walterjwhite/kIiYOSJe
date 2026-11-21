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
    description: "the machine's own view",
    icon: "beaker",
  },
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "queue",
    label: "Queue",
    description: "goals, and what needs action",
    icon: "inbox",
    command: "mind.queue",
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
    description: "absorb rate against Directions",
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
    group: "developer",
  },
  {
    id: "modelTrace",
    label: "Model Trace",
    description: "where model calls go, as a graph",
    icon: "type-hierarchy",
    command: "mind.modelTrace",
    group: "developer",
  },
  {
    id: "devices",
    label: "Devices",
    description: "paired clients, and pairing a new one",
    icon: "device-desktop",
    command: "mind.devices",
  },
  {
    id: "settings",
    label: "Settings",
    description: "audio, auto-linking, what is shown",
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
