import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_PERIOD,
  quietPeriodConfig,
  writeQuietPeriodConfig,
} from "./config.js";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-notify-"));

beforeEach(() => {
  writeQuietPeriodConfig({ ...DEFAULT_QUIET_PERIOD });
});

describe("quietPeriodConfig", () => {
  it("falls back to the documented defaults", () => {
    const config = quietPeriodConfig();
    expect(config.days).toEqual([1, 2, 3, 4, 5]);
    expect(config.startHour).toBe(8);
    expect(config.endHour).toBe(15);
  });

  it("round-trips a written window", () => {
    writeQuietPeriodConfig({ ...DEFAULT_QUIET_PERIOD, enabled: false, endHour: 17 });
    const config = quietPeriodConfig();
    expect(config.enabled).toBe(false);
    expect(config.endHour).toBe(17);
  });
});
