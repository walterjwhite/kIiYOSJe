import { describe, expect, it } from "vitest";
import {
  buildCoverage,
  type CoverageBucket,
  type CoverageReport,
  shortWeek,
} from "../src/coverage-model.js";

const bucket = (over: Partial<CoverageBucket> = {}): CoverageBucket => ({
  weekStart: "2026-11-02",
  signals: 10,
  absorbed: 6,
  absorbedUnanswered: 1,
  absorbRate: 0.6,
  thoughts: 3,
  ratio: 3.33,
  directions: 5,
  meetsTarget: true,
  ...over,
});

const report = (buckets: CoverageBucket[], over: Partial<CoverageReport> = {}): CoverageReport => ({
  weeks: buckets.length,
  target: 0.6,
  excludedFallback: 12,
  buckets,
  ...over,
});

describe("buildCoverage", () => {
  it("compares the first and last rated week, never a total", () => {
    const model = buildCoverage(
      report([
        bucket({ weekStart: "2026-10-05", absorbRate: 0.41, directions: 3, meetsTarget: false }),
        bucket({ weekStart: "2026-10-12", absorbRate: 0.5, directions: 6, meetsTarget: false }),
        bucket({ weekStart: "2026-10-19", absorbRate: 0.62, directions: 9, meetsTarget: true }),
      ]),
    );
    expect(model.headline).toBe("62% absorbed at 9 Directions, up from 41% at 3.");
    expect(model.caption).toBe("Explicit Directions only · catch-all excluded (12 signals)");
  });

  it("says down when the rate falls, and names the target when one week misses it", () => {
    expect(
      buildCoverage(
        report([
          bucket({ absorbRate: 0.7, directions: 2 }),
          bucket({ absorbRate: 0.55, directions: 8, meetsTarget: false }),
        ]),
      ).headline,
    ).toBe("55% absorbed at 8 Directions, down from 70% at 2.");

    expect(buildCoverage(report([bucket({ absorbRate: 0.42, meetsTarget: false })])).headline).toBe(
      "42% absorbed at 5 Directions — below the 60% target.",
    );
  });

  it("breaks the line at a week with no traffic instead of drawing through 0%", () => {
    const model = buildCoverage(
      report([
        bucket({ weekStart: "2026-10-05", absorbRate: 0.5 }),
        bucket({ weekStart: "2026-10-12", signals: 0, absorbed: 0, absorbRate: null }),
        bucket({ weekStart: "2026-10-19", absorbRate: 0.65 }),
      ]),
    );
    expect(model.points[1]).toMatchObject({ y: null, absorbRate: null, signals: 0 });
    expect(model.rateSegments).toHaveLength(2);
    expect(model.rateSegments[0]).toBe("64,95");
    expect(model.rateSegments[1]).toBe("876,71.9");
    expect(model.hasData).toBe(true);
  });

  it("scales Directions against the busiest week and steps between weeks", () => {
    const model = buildCoverage(
      report([
        bucket({ weekStart: "2026-10-05", directions: 5 }),
        bucket({ weekStart: "2026-10-12", directions: 10 }),
      ]),
    );
    expect(model.points.map((p) => p.directionsY)).toEqual([95, 18]);
    expect(model.directionsPath).toBe("M64,95 H876 V18");
  });

  it("puts the target line where 60% is, and keeps absorbing-unanswered separate", () => {
    const model = buildCoverage(
      report([
        bucket({ absorbRate: 0.6, absorbedUnanswered: 0 }),
        bucket({ absorbRate: 0.6, absorbedUnanswered: 4 }),
      ]),
    );
    expect(model.targetY).toBeCloseTo(79.6, 1);
    expect(model.ticks.map((t) => t.label)).toEqual(["100%", "50%", "0%"]);
    expect(model.points.map((p) => p.unansweredHeight)).toEqual([0, 40]);
    expect(model.absorbedUnanswered).toBe(4);
    // The bars live under the rate plot, so rising unanswered cannot hide under it.
    expect(model.barBaseY).toBeGreaterThan(model.baselineY);
  });

  it("labels a single week at the centre and handles an empty report", () => {
    const one = buildCoverage(report([bucket({ weekStart: "2026-11-02" })]));
    expect(one.points[0]?.x).toBe(470);
    expect(one.rateSegments).toEqual(["470,79.6"]);

    const none = buildCoverage({ buckets: [] });
    expect(none.hasData).toBe(false);
    expect(none.rateSegments).toEqual([]);
    expect(none.directionsPath).toBe("");
    expect(none.headline).toBe("No signal reached an explicit Direction yet.");
  });

  it("names weeks briefly and without locale drift", () => {
    expect(shortWeek("2026-11-02")).toBe("2 Nov");
    expect(shortWeek("2026-01-05T00:00:00.000Z")).toBe("5 Jan");
    expect(shortWeek("nonsense")).toBe("nonsense");
  });
});
