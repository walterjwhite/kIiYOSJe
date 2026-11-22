import { describe, expect, it } from "vitest";
import { MAX_DEFER_ATTEMPTS, nextAttemptDelayMs } from "./deferral.js";

describe("nextAttemptDelayMs", () => {
  it("waits a minute after the first failure and doubles each time", () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(120_000);
    expect(nextAttemptDelayMs(3)).toBe(240_000);
  });

  it("never waits more than an hour", () => {
    expect(nextAttemptDelayMs(10)).toBe(3_600_000);
    expect(nextAttemptDelayMs(50)).toBe(3_600_000);
  });

  it("treats a bad attempt number as the first", () => {
    expect(nextAttemptDelayMs(0)).toBe(60_000);
    expect(nextAttemptDelayMs(Number.NaN)).toBe(60_000);
  });

  it("gives up after about a day of trying, so a signal is never stuck", () => {
    let total = 0;
    for (let a = 1; a <= MAX_DEFER_ATTEMPTS; a++) total += nextAttemptDelayMs(a);
    expect(MAX_DEFER_ATTEMPTS).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThan(48 * 3_600_000);
  });
});
