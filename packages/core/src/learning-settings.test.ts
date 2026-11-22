import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEARNING_SETTINGS,
  isWithinLearningWindow,
  LearningSettingsSchema,
} from "./learning-settings.js";

const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m);

describe("isWithinLearningWindow", () => {
  it("defaults to 00:00 to 04:00", () => {
    expect(DEFAULT_LEARNING_SETTINGS).toMatchObject({ windowStart: "00:00", windowEnd: "04:00" });
    expect(isWithinLearningWindow(at(0, 0), DEFAULT_LEARNING_SETTINGS)).toBe(true);
    expect(isWithinLearningWindow(at(3, 59), DEFAULT_LEARNING_SETTINGS)).toBe(true);
    expect(isWithinLearningWindow(at(4, 0), DEFAULT_LEARNING_SETTINGS)).toBe(false);
    expect(isWithinLearningWindow(at(12, 0), DEFAULT_LEARNING_SETTINGS)).toBe(false);
  });
  it("supports a window that crosses midnight", () => {
    const s = { ...DEFAULT_LEARNING_SETTINGS, windowStart: "22:00", windowEnd: "02:00" };
    expect(isWithinLearningWindow(at(23), s)).toBe(true);
    expect(isWithinLearningWindow(at(1), s)).toBe(true);
    expect(isWithinLearningWindow(at(2), s)).toBe(false);
    expect(isWithinLearningWindow(at(12), s)).toBe(false);
  });
  it("treats equal start and end as the whole day", () => {
    const s = { ...DEFAULT_LEARNING_SETTINGS, windowStart: "06:00", windowEnd: "06:00" };
    expect(isWithinLearningWindow(at(15), s)).toBe(true);
  });
});

describe("LearningSettingsSchema", () => {
  it("rejects times that are not 24-hour HH:MM", () => {
    const parse = (windowStart: string) =>
      LearningSettingsSchema.safeParse({ windowStart, windowEnd: "04:00" }).success;
    expect(parse("24:00")).toBe(false);
    expect(parse("1:00")).toBe(false);
    expect(parse("01:30")).toBe(true);
  });
});

describe("idle trigger settings", () => {
  it("defaults: on, idle 10 min, 5 new decisions, 60 min between runs", () => {
    expect(DEFAULT_LEARNING_SETTINGS).toMatchObject({
      idleEnabled: true,
      idleMinutes: 10,
      minNewDecisions: 5,
      minGapMinutes: 60,
    });
  });
  it("fills the defaults when an older file or a request has only the window", () => {
    const parsed = LearningSettingsSchema.parse({ windowStart: "01:00", windowEnd: "03:00" });
    expect(parsed.idleMinutes).toBe(10);
    expect(parsed.idleEnabled).toBe(true);
  });
  it("rejects values outside the allowed range", () => {
    const base = { windowStart: "00:00", windowEnd: "04:00" };
    expect(LearningSettingsSchema.safeParse({ ...base, idleMinutes: 0 }).success).toBe(false);
    expect(LearningSettingsSchema.safeParse({ ...base, minNewDecisions: 0 }).success).toBe(false);
    expect(LearningSettingsSchema.safeParse({ ...base, minGapMinutes: 4 }).success).toBe(false);
    expect(LearningSettingsSchema.safeParse({ ...base, minGapMinutes: 5.5 }).success).toBe(false);
  });
});
