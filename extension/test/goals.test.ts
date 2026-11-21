import { describe, expect, it } from "vitest";
import { goalFlags, itemsForGoal, sortGoals, unlinkedItems, type Goal } from "../src/goals.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, title: id, body: "", nextAction: null, reviewAt: null, escalateBy: null, ...over,
});

describe("unlinkedItems / itemsForGoal", () => {
  const items = [{ goalId: null, n: 1 }, { goalId: "g1", n: 2 }, { goalId: "g2", n: 3 }, { goalId: "g1", n: 4 }];
  it("splits items by whether they have a goal", () => {
    expect(unlinkedItems(items).map((i) => i.n)).toEqual([1]);
    expect(itemsForGoal(items, "g1").map((i) => i.n)).toEqual([2, 4]);
    expect(itemsForGoal(items, "none")).toEqual([]);
  });
});

describe("goalFlags", () => {
  it("flags a passed deadline and a due review", () => {
    expect(goalFlags({ escalateBy: "2026-11-19T00:00:00Z", reviewAt: "2026-11-20T12:00:00Z" }, NOW)).toEqual(["overdue", "review"]);
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
