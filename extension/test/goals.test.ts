import { describe, expect, it } from "vitest";
import {
  canMoveUnder,
  goalFlags,
  goalTree,
  itemsForGoal,
  sortGoals,
  unlinkedItems,
  type Goal,
} from "../src/goals.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id,
  title: id,
  body: "",
  nextAction: null,
  reviewAt: null,
  escalateBy: null,
  parentId: null,
  ...over,
});

describe("canMoveUnder", () => {
  const goals = [goal("a"), goal("b", { parentId: "a" }), goal("c", { parentId: "b" }), goal("d")];
  it("allows moving a goal under an unrelated goal, or to top level", () => {
    expect(canMoveUnder(goals, "d", "a")).toBe(true);
    expect(canMoveUnder(goals, "c", null)).toBe(true);
  });
  it("refuses itself, a descendant, and an unknown goal", () => {
    expect(canMoveUnder(goals, "a", "a")).toBe(false);
    expect(canMoveUnder(goals, "a", "c")).toBe(false);
    expect(canMoveUnder(goals, "d", "missing")).toBe(false);
    expect(canMoveUnder(goals, "missing", "a")).toBe(false);
  });
  it("refuses a move that changes nothing", () => {
    expect(canMoveUnder(goals, "b", "a")).toBe(false);
    expect(canMoveUnder(goals, "a", null)).toBe(false);
  });
});

describe("unlinkedItems / itemsForGoal", () => {
  const items = [
    { goalId: null, n: 1 },
    { goalId: "g1", n: 2 },
    { goalId: "g2", n: 3 },
    { goalId: "g1", n: 4 },
  ];
  it("splits items by whether they have a goal", () => {
    expect(unlinkedItems(items).map((i) => i.n)).toEqual([1]);
    expect(itemsForGoal(items, "g1").map((i) => i.n)).toEqual([2, 4]);
    expect(itemsForGoal(items, "none")).toEqual([]);
  });
});

describe("goalFlags", () => {
  it("flags a passed deadline and a due review", () => {
    expect(
      goalFlags({ escalateBy: "2026-11-19T00:00:00Z", reviewAt: "2026-11-20T12:00:00Z" }, NOW),
    ).toEqual(["overdue", "review"]);
  });
  it("ignores future dates, missing dates and garbage", () => {
    expect(goalFlags({ escalateBy: "2026-11-21T00:00:00Z", reviewAt: null }, NOW)).toEqual([]);
    expect(goalFlags({ escalateBy: "not a date", reviewAt: "" }, NOW)).toEqual([]);
  });
});

describe("sortGoals", () => {
  it("puts overdue first, then review-due, then alphabetical, without mutating the input", () => {
    const input = [
      goal("b"),
      goal("a"),
      goal("review", { reviewAt: "2026-11-01T00:00:00Z" }),
      goal("late", { escalateBy: "2026-11-01T00:00:00Z" }),
    ];
    const copy = [...input];
    expect(sortGoals(input, NOW).map((g) => g.id)).toEqual(["late", "review", "a", "b"]);
    expect(input).toEqual(copy);
  });
});

describe("goalTree", () => {
  it("lists each sub-goal directly after its parent with a depth", () => {
    const goals = [
      goal("b"),
      goal("a"),
      goal("a2", { parentId: "a" }),
      goal("a1", { parentId: "a" }),
      goal("a1x", { parentId: "a1" }),
    ];
    expect(goalTree(goals, NOW).map((n) => [n.goal.id, n.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a1x", 2],
      ["a2", 1],
      ["b", 0],
    ]);
  });

  it("shows a sub-goal as top-level when its parent is not in the list", () => {
    const tree = goalTree([goal("child", { parentId: "parked" })], NOW);
    expect(tree.map((n) => [n.goal.id, n.depth])).toEqual([["child", 0]]);
  });

  it("does not loop or drop goals when parents form a cycle", () => {
    const tree = goalTree([goal("a", { parentId: "b" }), goal("b", { parentId: "a" })], NOW);
    expect(tree.map((n) => n.goal.id).sort()).toEqual(["a", "b"]);
  });
});
