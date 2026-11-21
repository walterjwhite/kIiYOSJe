/**
 * Goal helpers for the Queue. Pure, no vscode import, unit-tested.
 *
 * A Goal is a Thought in the "goal" state. A Queue item is linked to a Goal
 * when the server reports a `goalId` for it.
 */

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly nextAction: string | null;
  readonly reviewAt: string | null;
  readonly escalateBy: string | null;
  /** The goal this one is a sub-goal of, or null for a top-level goal. */
  readonly parentId: string | null;
}

export interface Linkable {
  readonly goalId: string | null;
}

export type GoalFlag = "overdue" | "review";

export const unlinkedItems = <T extends Linkable>(items: readonly T[]): T[] =>
  items.filter((i) => i.goalId === null);

export const itemsForGoal = <T extends Linkable>(items: readonly T[], goalId: string): T[] =>
  items.filter((i) => i.goalId === goalId);

/** What needs attention on a goal itself: its deadline passed, or it is due for review. */
export function goalFlags(goal: Pick<Goal, "reviewAt" | "escalateBy">, now: Date): GoalFlag[] {
  const flags: GoalFlag[] = [];
  const passed = (iso: string | null) =>
    iso !== null && !Number.isNaN(Date.parse(iso)) && Date.parse(iso) <= now.getTime();
  if (passed(goal.escalateBy)) flags.push("overdue");
  if (passed(goal.reviewAt)) flags.push("review");
  return flags;
}

/** Overdue goals first, then review-due, then the rest alphabetically. Does not mutate its input. */
export function sortGoals<T extends Goal>(goals: readonly T[], now: Date): T[] {
  const rank = (g: T) => {
    const f = goalFlags(g, now);
    return f.includes("overdue") ? 0 : f.includes("review") ? 1 : 2;
  };
  return [...goals].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

export interface GoalNode<T extends Goal> {
  readonly goal: T;
  /** 0 for a top-level goal, 1 for its sub-goals, and so on. */
  readonly depth: number;
}

/**
 * Goals in display order: each goal is followed by its sub-goals (recursively),
 * siblings sorted by `sortGoals`. A goal whose parent is not in the list (the
 * parent was closed or parked) is shown top-level. Goals caught in a parent
 * cycle are still shown, top-level, so none can disappear.
 */
export function goalTree<T extends Goal>(goals: readonly T[], now: Date): GoalNode<T>[] {
  const ids = new Set(goals.map((g) => g.id));
  const childrenOf = new Map<string | null, T[]>();
  for (const g of goals) {
    const key =
      g.parentId !== null && ids.has(g.parentId) && g.parentId !== g.id ? g.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), g]);
  }
  const out: GoalNode<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const g of sortGoals(childrenOf.get(parent) ?? [], now)) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ goal: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything unreached sits in a cycle; show it rather than lose it.
  for (const g of sortGoals(goals, now)) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      out.push({ goal: g, depth: 0 });
      walk(g.id, 1);
    }
  }
  return out;
}
