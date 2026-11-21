import { describe, expect, it } from "vitest";
import { type GoalDoc, rankGoals, senderKey, tokenize } from "./link-candidates.js";
import { FIXTURE_GOALS, FIXTURE_SIGNALS } from "./link-fixtures.js";

const goal = (
  id: string,
  title: string,
  body = "",
  parentTitle: string | null = null,
): GoalDoc => ({
  id,
  title,
  body,
  parentTitle,
});
const msg = (over: Partial<Parameters<typeof rankGoals>[0]> = {}) => ({
  sender: "someone@example.com",
  subject: null,
  body: "",
  ...over,
});

describe("tokenize / senderKey", () => {
  it("lowercases, drops stopwords and short words, strips a plural", () => {
    expect(tokenize("The Reports are for 2026 QA")).toEqual(["report", "2026"]);
  });
  it("treats a display name and a bare address as the same sender", () => {
    expect(senderKey("Ana Ruiz <ANA@Example.com>")).toBe(senderKey("ana@example.com"));
  });
});

describe("rankGoals", () => {
  const goals = [
    goal("a", "Ship the Q4 report"),
    goal("b", "Hire a designer"),
    goal("c", "Plan the offsite"),
  ];

  it("puts the goal whose words the message uses first", () => {
    const top = rankGoals(msg({ subject: "Q4 report draft", body: "numbers attached" }), goals, []);
    expect(top[0]?.goal.id).toBe("a");
  });

  it("returns at most the limit, and nothing when no goal shares a word", () => {
    expect(rankGoals(msg({ body: "report designer offsite" }), goals, [], 2)).toHaveLength(2);
    expect(rankGoals(msg({ body: "completely unrelated lunch" }), goals, [])).toEqual([]);
    expect(rankGoals(msg({ body: "report" }), [], [])).toEqual([]);
  });

  it("matches a sub-goal through its parent's title", () => {
    const sub = [goal("s", "Review", "", "Ship the Q4 report"), goal("x", "Garden")];
    expect(rankGoals(msg({ body: "the q4 report is ready" }), sub, [])[0]?.goal.id).toBe("s");
  });

  it("counts a sender the operator already linked to a goal, and returns the exemplars", () => {
    const from = "ana@example.com";
    const ranked = rankGoals(
      msg({ sender: "Ana <ana@example.com>", body: "quick question" }),
      goals,
      [{ goalId: "b", sender: from, subject: "Interview slots" }],
    );
    expect(ranked[0]?.goal.id).toBe("b");
    expect(ranked[0]?.sameSender).toBe(true);
    expect(ranked[0]?.exemplars[0]?.subject).toBe("Interview slots");
  });

  it("uses the subjects of manually linked messages as extra words for the goal", () => {
    const ranked = rankGoals(msg({ body: "invoice for catering" }), goals, [
      { goalId: "c", sender: "x@example.com", subject: "Catering invoice" },
    ]);
    expect(ranked[0]?.goal.id).toBe("c");
  });

  it("strongly favours a goal the same thread is already linked to", () => {
    const ranked = rankGoals(msg({ body: "report designer", threadGoalIds: ["c"] }), goals, []);
    expect(ranked[0]?.goal.id).toBe("c");
  });
});

describe("retrieval quality on the synthetic set", () => {
  const labelled = FIXTURE_SIGNALS.filter((s) => s.expected !== null);
  const recallAt = (k: number) =>
    labelled.filter((s) => rankGoals(s, FIXTURE_GOALS, [], k).some((c) => c.goal.id === s.expected))
      .length / labelled.length;
  // The old behaviour: only the first 25 goals reached the model.
  const baseline =
    labelled.filter((s) => FIXTURE_GOALS.slice(0, 25).some((g) => g.id === s.expected)).length /
    labelled.length;

  it("puts the right goal in the top 3 for nearly every message, beating the first-25 prompt", () => {
    // Recorded, not asserted loosely: a drop here is a retrieval regression.
    console.info(
      `link retrieval: recall@1=${recallAt(1).toFixed(2)} recall@3=${recallAt(3).toFixed(2)} first-25 baseline=${baseline.toFixed(2)}`,
    );
    expect(recallAt(3)).toBeGreaterThanOrEqual(0.9);
    expect(recallAt(3)).toBeGreaterThan(baseline);
  });

  it("offers no candidate for messages that belong to no goal", () => {
    const none = FIXTURE_SIGNALS.filter((s) => s.expected === null);
    for (const s of none) expect(rankGoals(s, FIXTURE_GOALS, [], 3)).toEqual([]);
  });
});
