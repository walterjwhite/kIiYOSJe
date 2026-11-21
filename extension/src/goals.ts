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
}

export interface Linkable {
  readonly goalId: string | null;
}

export type GoalFlag = "overdue" | "review";

export const unlinkedItems = <T extends Linkable>(items: readonly T[]): T[] => items.filter((i) => i.goalId === null);

export const itemsForGoal = <T extends Linkable>(items: readonly T[], goalId: string): T[] =>
  items.filter((i) => i.goalId === goalId);

/** What needs attention on a goal itself: its deadline passed, or it is due for review. */
export function goalFlags(goal: Pick<Goal, "reviewAt" | "escalateBy">, now: Date): GoalFlag[] {
  const flags: GoalFlag[] = [];
  const passed = (iso: string | null) => iso !== null && !Number.isNaN(Date.parse(iso)) && Date.parse(iso) <= now.getTime();
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
