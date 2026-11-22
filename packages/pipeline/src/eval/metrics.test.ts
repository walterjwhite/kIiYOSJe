import { describe, expect, it } from "vitest";
import { computeMetrics, type FixtureOutcome } from "./metrics.js";

const out = (over: Partial<FixtureOutcome>): FixtureOutcome => ({
  id: "x",
  known: null,
  error: null,
  expectedDirectionId: "boss",
  expectedSurfaced: false,
  directionId: "boss",
  disposition: "absorbed",
  thoughtCreated: false,
  ...over,
});

describe("computeMetrics", () => {
  it("computes recall, precision, and false-absorb from the labels", () => {
    const m = computeMetrics(
      [
        out({ id: "a", expectedSurfaced: true, disposition: "escalated", thoughtCreated: true }),
        out({ id: "b", expectedSurfaced: true, disposition: "absorbed" }),
        out({ id: "c", expectedSurfaced: false, disposition: "escalated", thoughtCreated: true }),
        out({ id: "d", expectedSurfaced: false, disposition: "absorbed" }),
      ],
      0,
    );
    expect(m.surfaceRecall).toBe(0.5); // 1 of 2 wanted
    expect(m.surfacePrecision).toBe(0.5); // 1 of 2 surfaced
    expect(m.falseAbsorbRate).toBe(0.5); // 1 of 2 absorbed was wanted
    expect(m.failures.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("counts promoted as surfaced", () => {
    const m = computeMetrics(
      [out({ expectedSurfaced: true, disposition: "promoted", thoughtCreated: true })],
      0,
    );
    expect(m.surfaceRecall).toBe(1);
  });

  it("reports null, not 0 or 1, when a denominator is empty", () => {
    const m = computeMetrics([out({ expectedSurfaced: false, disposition: "absorbed" })], 0);
    expect(m.surfaceRecall).toBeNull(); // nothing was wanted
    expect(m.surfacePrecision).toBeNull(); // nothing was surfaced
    expect(m.ratio).toBeNull(); // no Thoughts
    expect(computeMetrics([], 0).falseAbsorbRate).toBeNull();
  });

  it("measures direction accuracy over explicit Directions only", () => {
    const m = computeMetrics(
      [
        out({ id: "a", expectedDirectionId: "boss", directionId: "boss" }),
        out({ id: "b", expectedDirectionId: "boss", directionId: "system/catch-all" }),
        out({
          id: "c",
          expectedDirectionId: "system/catch-all",
          directionId: "system/catch-all",
        }),
      ],
      0,
    );
    expect(m.directionAccuracy).toBe(0.5);
    expect(m.catchAllShare).toBeCloseTo(2 / 3);
    expect(m.failures.map((f) => f.id)).toEqual(["b"]);
  });

  it("computes signals per Thought", () => {
    const m = computeMetrics(
      [
        out({ disposition: "escalated", expectedSurfaced: true, thoughtCreated: true }),
        out({}),
        out({}),
        out({}),
      ],
      0,
    );
    expect(m.ratio).toBe(4);
  });

  it("lists known fixtures separately and keeps them out of the numbers", () => {
    const m = computeMetrics(
      [
        out({ id: "a" }),
        out({ id: "k", known: "matcher misses synonyms", expectedSurfaced: true }),
      ],
      0,
    );
    expect(m.counted).toBe(1);
    expect(m.known.map((k) => k.id)).toEqual(["k"]);
    expect(m.surfaceRecall).toBeNull();
    expect(m.failures).toEqual([]);
  });

  it("fails a fixture that errored and keeps it out of the metrics", () => {
    const m = computeMetrics([out({ id: "e", error: "boom" })], 0);
    expect(m.failures).toEqual([expect.objectContaining({ id: "e", reason: "error: boom" })]);
    expect(m.counted).toBe(0);
  });

  it("carries the gate violation count through", () => {
    expect(computeMetrics([], 2).gateViolations).toBe(2);
  });
});
