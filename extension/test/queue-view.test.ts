import { describe, expect, it } from "vitest";
import {
  addDays,
  dueUnplanned,
  groupByDate,
  inView,
  localDate,
  nextMonday,
  parsePlanDate,
  planLabel,
  planState,
  viewCounts,
} from "../src/queue-view.js";

const TODAY = "2026-11-19"; // a Thursday
const item = (plannedFor: string | null, bucket = "can-wait", actBy: string | null = null) => ({
  plannedFor,
  timing: { bucket, actBy },
});

describe("dates", () => {
  it("formats the local date", () => {
    expect(localDate(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the next Monday strictly after a date", () => {
    expect(nextMonday("2026-11-19")).toBe("2026-11-23"); // Thu
    expect(nextMonday("2026-11-22")).toBe("2026-11-23"); // Sun
    expect(nextMonday("2026-11-23")).toBe("2026-11-30"); // Mon -> following Mon
  });
});

describe("planState and inView", () => {
  it("classifies by plan", () => {
    expect(planState(null, TODAY)).toBe("backlog");
    expect(planState("2026-11-18", TODAY)).toBe("overdue");
    expect(planState(TODAY, TODAY)).toBe("today");
    expect(planState("2026-11-20", TODAY)).toBe("upcoming");
  });

  it("puts carried-over plans in Today so they are not lost", () => {
    expect(inView(item("2026-11-17"), "today", TODAY)).toBe(true);
    expect(inView(item("2026-11-17"), "upcoming", TODAY)).toBe(false);
  });

  it("counts each view", () => {
    const items = [item(null), item(null), item(TODAY), item("2026-11-10"), item("2026-12-01")];
    expect(viewCounts(items, TODAY)).toEqual({ today: 2, upcoming: 1, backlog: 2, all: 5 });
  });
});

describe("dueUnplanned", () => {
  it("flags unplanned items that are due now or due today, not planned or later ones", () => {
    const due = item(null, "now");
    const dueToday = item(null, "today", new Date(2026, 10, 19, 17).toISOString());
    const later = item(null, "this-week", new Date(2026, 10, 24, 17).toISOString());
    const planned = item(TODAY, "now");
    expect(dueUnplanned([due, dueToday, later, planned], TODAY)).toEqual([due, dueToday]);
  });
});

describe("planLabel", () => {
  it("names the common cases", () => {
    expect(planLabel(null, TODAY)).toBe("Backlog");
    expect(planLabel(TODAY, TODAY)).toBe("Today");
    expect(planLabel("2026-11-20", TODAY)).toBe("Tomorrow");
    expect(planLabel("2026-11-18", TODAY)).toMatch(/^Carried over from /);
    expect(planLabel("2026-11-25", TODAY)).toMatch(/25/);
  });
});

describe("parsePlanDate", () => {
  it("accepts today and later real dates", () => {
    expect(parsePlanDate(" 2026-11-19 ", TODAY)).toBe("2026-11-19");
    expect(parsePlanDate("2027-01-05", TODAY)).toBe("2027-01-05");
  });
  it.each(["2026-11-18", "2026-02-30", "2026-13-01", "next week", "2026-1-5", ""])("rejects %j", (v) => {
    expect(parsePlanDate(v, TODAY)).toBeUndefined();
  });
});

describe("groupByDate", () => {
  it("groups by date in ascending order and skips the unplanned", () => {
    const a = item("2026-11-22");
    const b = item("2026-11-20");
    const c = item("2026-11-22");
    const groups = groupByDate([a, b, c, item(null)]);
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([["2026-11-20", 1], ["2026-11-22", 2]]);
  });
});
