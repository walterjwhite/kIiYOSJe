/**
 * Turns the per-combination signal counts from GET /metrics/flow into the three
 * columns drawn in Analytics: channel, Direction, outcome. Pure, no vscode
 * import, unit-tested.
 *
 * Every link keeps the filter that selects exactly the signals behind it, so
 * clicking a node or a line can list them.
 */

export interface FlowRow {
  adapter: string;
  directionId: string | null;
  directionName: string | null;
  disposition: string;
  count: number;
}

/** Query parameters understood by GET /metrics/signals. */
export interface FlowFilter {
  adapter?: string;
  directionId?: string;
  disposition?: string;
}

export type FlowTone = "good" | "accent" | "bad" | "muted";

export interface FlowNode {
  id: string;
  label: string;
  count: number;
  tone: FlowTone;
  /** Null for nodes that stand for several things (Other) or for nothing selectable. */
  filter: FlowFilter | null;
}

export interface FlowLink {
  from: string;
  to: string;
  count: number;
  filter: FlowFilter | null;
}

export interface FlowGraph {
  columns: { title: string; nodes: FlowNode[] }[];
  links: FlowLink[];
  total: number;
}

const OUTCOMES: Record<string, { label: string; tone: FlowTone; order: number }> = {
  absorbed: { label: "Absorbed", tone: "good", order: 0 },
  filed: { label: "Filed", tone: "muted", order: 1 },
  promoted: { label: "Surfaced", tone: "accent", order: 2 },
  escalated: { label: "Escalated", tone: "bad", order: 3 },
  new: { label: "Unprocessed", tone: "muted", order: 4 },
};

const OTHER = "*other";
const NONE = "*none";

interface Tally {
  count: number;
}

const bump = <K>(m: Map<K, Tally>, key: K, by: number) => {
  const t = m.get(key);
  if (t) t.count += by;
  else m.set(key, { count: by });
};

/** The `keep` largest keys stay, the rest are folded into one Other key. */
function topKeys(totals: Map<string, Tally>, keep: number): Set<string> {
  return new Set(
    [...totals.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, keep)
      .map(([k]) => k),
  );
}

export function buildFlow(rows: readonly FlowRow[], maxNodesPerColumn = 8): FlowGraph {
  const live = rows.filter((r) => r.count > 0);
  const names = new Map<string, string>();
  for (const r of live) if (r.directionId) names.set(r.directionId, r.directionName ?? r.directionId);

  const channelTotals = new Map<string, Tally>();
  const directionTotals = new Map<string, Tally>();
  for (const r of live) {
    bump(channelTotals, r.adapter, r.count);
    bump(directionTotals, r.directionId ?? NONE, r.count);
  }
  const keepChannels = topKeys(channelTotals, maxNodesPerColumn);
  const keepDirections = topKeys(directionTotals, maxNodesPerColumn);
  const channelOf = (r: FlowRow) => (keepChannels.has(r.adapter) ? r.adapter : OTHER);
  const directionOf = (r: FlowRow) => {
    const key = r.directionId ?? NONE;
    return keepDirections.has(key) ? key : OTHER;
  };

  const channels = new Map<string, Tally>();
  const directionsMap = new Map<string, Tally>();
  const outcomes = new Map<string, Tally>();
  const left = new Map<string, FlowLink>();
  const right = new Map<string, FlowLink>();

  for (const r of live) {
    const c = channelOf(r);
    const d = directionOf(r);
    bump(channels, c, r.count);
    bump(directionsMap, d, r.count);
    bump(outcomes, r.disposition, r.count);

    const leftKey = `${c}>${d}`;
    const l = left.get(leftKey);
    if (l) l.count += r.count;
    else {
      const filter: FlowFilter | null =
        c !== OTHER && d !== OTHER && d !== NONE ? { adapter: c, directionId: d } : null;
      left.set(leftKey, { from: `c:${c}`, to: `d:${d}`, count: r.count, filter });
    }

    const rightKey = `${d}>${r.disposition}`;
    const rl = right.get(rightKey);
    if (rl) rl.count += r.count;
    else {
      const filter: FlowFilter | null =
        d !== OTHER && d !== NONE ? { directionId: d, disposition: r.disposition } : null;
      right.set(rightKey, { from: `d:${d}`, to: `o:${r.disposition}`, count: r.count, filter });
    }
  }

  const bySize = (a: [string, Tally], b: [string, Tally]) => b[1].count - a[1].count || a[0].localeCompare(b[0]);
  // Other and unmatched always sit last so the named entries stay together.
  const lastLast = (a: [string, Tally], b: [string, Tally]) => {
    const rank = (k: string) => (k === OTHER ? 2 : k === NONE ? 1 : 0);
    return rank(a[0]) - rank(b[0]) || bySize(a, b);
  };

  const channelNodes: FlowNode[] = [...channels.entries()].sort(lastLast).map(([id, t]) => ({
    id: `c:${id}`,
    label: id === OTHER ? "Other channels" : id,
    count: t.count,
    tone: "accent",
    filter: id === OTHER ? null : { adapter: id },
  }));
  const directionNodes: FlowNode[] = [...directionsMap.entries()].sort(lastLast).map(([id, t]) => ({
    id: `d:${id}`,
    label: id === OTHER ? "Other directions" : id === NONE ? "No direction" : (names.get(id) ?? id),
    count: t.count,
    tone: id === OTHER || id === NONE ? "muted" : "accent",
    filter: id === OTHER || id === NONE ? null : { directionId: id },
  }));
  const outcomeNodes: FlowNode[] = [...outcomes.entries()]
    .sort((a, b) => (OUTCOMES[a[0]]?.order ?? 99) - (OUTCOMES[b[0]]?.order ?? 99) || a[0].localeCompare(b[0]))
    .map(([id, t]) => ({
      id: `o:${id}`,
      label: OUTCOMES[id]?.label ?? id,
      count: t.count,
      tone: OUTCOMES[id]?.tone ?? "muted",
      filter: { disposition: id },
    }));

  return {
    columns: [
      { title: "Channel", nodes: channelNodes },
      { title: "Direction", nodes: directionNodes },
      { title: "Outcome", nodes: outcomeNodes },
    ],
    links: [...left.values(), ...right.values()],
    total: live.reduce((n, r) => n + r.count, 0),
  };
}
