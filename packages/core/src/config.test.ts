import { afterEach, describe, it, expect } from "vitest";
import {
  configDir,
  dataDir,
  isWithinNotificationWindow,
  DEFAULT_QUIET_PERIOD,
} from "./config.js";
import type { QuietPeriodConfig } from "./config.js";

// Nov 2026, local time: the 9th is a Monday, the 14th is a Saturday.
const MONDAY_DAY = 9;
const SATURDAY_DAY = 14;

function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 10, day, hour, minute, 0, 0); // month is 0-indexed
}

describe("directory overrides", () => {
  const previousDataDir = process.env["MIND_DATA_DIR"];
  const previousConfigDir = process.env["MIND_CONFIG_DIR"];

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env["MIND_DATA_DIR"];
    else process.env["MIND_DATA_DIR"] = previousDataDir;
    if (previousConfigDir === undefined) delete process.env["MIND_CONFIG_DIR"];
    else process.env["MIND_CONFIG_DIR"] = previousConfigDir;
  });

  it("honors MIND_DATA_DIR", () => {
    process.env["MIND_DATA_DIR"] = "/tmp/mind-data-override";
    expect(dataDir()).toBe("/tmp/mind-data-override");
  });

  it("honors MIND_CONFIG_DIR", () => {
    process.env["MIND_CONFIG_DIR"] = "/tmp/mind-config-override";
    expect(configDir()).toBe("/tmp/mind-config-override");
  });
});

describe("isWithinNotificationWindow", () => {
  it("allows a weekday within the default window", () => {
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 10, 0), DEFAULT_QUIET_PERIOD)).toBe(true);
  });

  it("blocks a weekday before the window opens", () => {
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 6, 0), DEFAULT_QUIET_PERIOD)).toBe(false);
  });

  it("blocks a weekday after the window closes", () => {
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 20, 0), DEFAULT_QUIET_PERIOD)).toBe(false);
  });

  it("blocks the exact end-of-window minute (end is exclusive)", () => {
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 15, 0), DEFAULT_QUIET_PERIOD)).toBe(false);
  });

  it("allows the exact start-of-window minute (start is inclusive)", () => {
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 8, 0), DEFAULT_QUIET_PERIOD)).toBe(true);
  });

  it("blocks a weekend day even during window hours", () => {
    expect(isWithinNotificationWindow(at(SATURDAY_DAY, 10, 0), DEFAULT_QUIET_PERIOD)).toBe(false);
  });

  it("always allows when disabled, regardless of day or time", () => {
    const disabled: QuietPeriodConfig = { ...DEFAULT_QUIET_PERIOD, enabled: false };
    expect(isWithinNotificationWindow(at(SATURDAY_DAY, 2, 0), disabled)).toBe(true);
  });

  it("supports a custom window that crosses midnight", () => {
    const overnight: QuietPeriodConfig = {
      enabled: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
    };
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 23, 0), overnight)).toBe(true);
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 3, 0), overnight)).toBe(true);
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 12, 0), overnight)).toBe(false);
  });

  it("respects a custom days list (e.g. weekends only)", () => {
    const weekendsOnly: QuietPeriodConfig = {
      ...DEFAULT_QUIET_PERIOD,
      days: [0, 6],
    };
    expect(isWithinNotificationWindow(at(SATURDAY_DAY, 10, 0), weekendsOnly)).toBe(true);
    expect(isWithinNotificationWindow(at(MONDAY_DAY, 10, 0), weekendsOnly)).toBe(false);
  });
});
