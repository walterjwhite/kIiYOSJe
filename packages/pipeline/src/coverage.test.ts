import { describe, expect, it } from "vitest";
import { mondayOf, weeklyCoverage } from "./coverage.js";

const NOW = new Date("2026-11-18T12:00:00.000Z"); // a Wednesday

function signal(receivedAt: string, disposition = "absorbed", extra = {}) {
  return { receivedAt, disposition, ...extra };
}

describe("mondayOf", () => {
  it("returns the Monday of the week in UTC", () => {
    expect(mondayOf(NOW).toISOString().slice(0, 10)).toBe("2026-11-16");
  });

  it("is stable for a Monday", () => {
    expect(mondayOf(new Date("2026-11-16T00:00:00.000Z")).toISOString().slice(0, 10)).toBe(
      "2026-11-16",
    );
  });
});

describe("weeklyCoverage", () => {
  it("buckets signals and thoughts by week and computes the ratio", () => {
    const report = weeklyCoverage(
      {
        signals: [
          signal("2026-11-17T09:00:00.000Z"),
          signal("2026-11-17T10:00:00.000Z"),
          signal("2026-11-17T11:00:00.000Z", "escalated"),
          signal("2026-11-10T09:00:00.000Z"),
        ],
        thoughts: [{ createdAt: "2026-11-10T12:00:00.000Z" }],
        directions: [{ createdAt: "2026-11-01T00:00:00.000Z", enabled: true }],
      },
      { weeks: 2, now: NOW },
    );

    expect(report.buckets).toHaveLength(2);
    expect(report.buckets[0]).toMatchObject({
      weekStart: "2026-11-09",
      signals: 1,
      absorbed: 1,
      thoughts: 1,
      ratio: 1,
      directions: 1,
      absorbRate: 1,
    });
    expect(report.buckets[1]).toMatchObject({
      weekStart: "2026-11-16",
      signals: 3,
      absorbed: 2,
      absorbRate: 0.6667,
      meetsTarget: true,
    });
    expect(report.totals).toMatchObject({
      signals: 4,
      absorbed: 3,
      thoughts: 1,
      ratio: 4,
      absorbRate: 0.75,
      meetsTarget: true,
    });
  });

  it("counts absorbed-but-unanswered separately so it cannot hide", () => {
    const report = weeklyCoverage(
      {
        signals: [
          signal("2026-11-17T09:00:00.000Z", "absorbed", {
            awaitingReplyAt: "2026-11-17T10:00:00.000Z",
            replyReceivedAt: null,
          }),
          signal("2026-11-17T11:00:00.000Z", "absorbed", {
            awaitingReplyAt: "2026-11-17T12:00:00.000Z",
            replyReceivedAt: "2026-11-17T15:00:00.000Z",
          }),
        ],
        thoughts: [],
        directions: [],
      },
      { weeks: 1, now: NOW },
    );

    expect(report.totals.absorbed).toBe(2);
    expect(report.totals.absorbedUnanswered).toBe(1);
    expect(report.totals.meetsTarget).toBe(true);
  });

  it("reports a null rate rather than 0 when there is no traffic", () => {
    const report = weeklyCoverage(
      { signals: [], thoughts: [], directions: [] },
      { weeks: 3, now: NOW },
    );

    expect(report.buckets.every((b) => b.absorbRate === null)).toBe(true);
    expect(report.buckets.every((b) => b.meetsTarget === false)).toBe(true);
    expect(report.totals.absorbRate).toBeNull();
    expect(report.totals.ratio).toBeNull();
  });

  it("drops rows older than the window", () => {
    const report = weeklyCoverage(
      {
        signals: [signal("2026-01-01T00:00:00.000Z")],
        thoughts: [],
        directions: [],
      },
      { weeks: 2, now: NOW },
    );

    expect(report.totals.signals).toBe(0);
  });

  it("counts a Direction only from the week it was created", () => {
    const report = weeklyCoverage(
      {
        signals: [],
        thoughts: [],
        directions: [{ createdAt: "2026-11-18T00:00:00.000Z", enabled: true }],
      },
      { weeks: 2, now: NOW },
    );

    expect(report.buckets[0]!.directions).toBe(0);
    expect(report.buckets[1]!.directions).toBe(1);
  });
});
