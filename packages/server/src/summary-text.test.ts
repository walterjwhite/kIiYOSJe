import { describe, it, expect } from "vitest";
import { buildSummary, spokenDate, type SummaryInput } from "./summary-text.js";

const base: SummaryInput = {
  date: "2026-11-20",
  goals: [],
  queue: { now: 0, today: 0, thisWeek: 0, canWait: 0, unlinked: 0 },
  top: [],
  absorbedToday: 0,
};

describe("buildSummary", () => {
  it("says so when nothing is waiting and there are no goals", () => {
    const text = buildSummary(base, "neutral");
    expect(text).toContain("Summary for Friday, November 20.");
    expect(text).toContain("You have no goals set.");
    expect(text).toContain("Nothing is waiting on you.");
  });

  it("changes only the greeting with tone", () => {
    const calm = buildSummary(base, "calm").split("\n").slice(1);
    const upbeat = buildSummary(base, "upbeat").split("\n").slice(1);
    expect(calm).toEqual(upbeat);
    expect(buildSummary(base, "upbeat").split("\n")[0]).toContain("!");
  });

  it("reports goals with their linked items and flags", () => {
    const text = buildSummary(
      { ...base, goals: [{ title: "Ship the report", linked: 2, overdue: true, reviewDue: false }] },
      "neutral",
    );
    expect(text).toContain("You have 1 goal.");
    expect(text).toContain("Ship the report: 2 items linked, and it is overdue.");
  });

  it("counts the queue by urgency and lists the most pressing items", () => {
    const text = buildSummary(
      {
        ...base,
        queue: { now: 1, today: 2, thisWeek: 0, canWait: 1, unlinked: 3 },
        top: [{ sender: "boss@example.com", summary: "Need the numbers", bucket: "now" }],
        absorbedToday: 4,
      },
      "neutral",
    );
    expect(text).toContain("4 items awaiting action: 1 need you now, 2 today, 1 can wait.");
    expect(text).toContain("3 of them are not linked to a goal.");
    expect(text).toContain("boss@example.com: Need the numbers.");
    expect(text).toContain("4 messages were handled without reaching you.");
  });

  it("never reads out a long message in full", () => {
    const long = "word ".repeat(200);
    const text = buildSummary(
      { ...base, queue: { ...base.queue, now: 1 }, top: [{ sender: "a", summary: long, bucket: "now" }] },
      "neutral",
    );
    expect(Math.max(...text.split("\n").map((l) => l.length))).toBeLessThan(140);
  });
});

describe("spokenDate", () => {
  it("formats a calendar date without shifting the day", () => {
    expect(spokenDate("2026-01-01")).toBe("Thursday, January 1");
  });
});
