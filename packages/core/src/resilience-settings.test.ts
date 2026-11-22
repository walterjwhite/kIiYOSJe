import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RESILIENCE_SETTINGS,
  ResilienceSettingsSchema,
  resilienceSettings,
  resilienceSettingsPath,
  writeResilienceSettings,
} from "./resilience-settings.js";

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ["MIND_CONFIG_DIR", "MIND_DATA_DIR"]) {
    saved[key] = process.env[key];
    process.env[key] = mkdtempSync(join(tmpdir(), "mind-resilience-"));
  }
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resilience settings", () => {
  it("defaults: 120 s timeout, 2 retries, breaker at 5 failures for 60 s, 2 at once", () => {
    expect(resilienceSettings()).toEqual({
      timeoutSeconds: 120,
      retries: 2,
      retryDelayMs: 1000,
      breakerFailures: 5,
      breakerResetSeconds: 60,
      maxConcurrent: 2,
    });
    expect(DEFAULT_RESILIENCE_SETTINGS.maxConcurrent).toBe(2);
  });

  it("saves, reads back, and fills defaults for missing fields", () => {
    writeResilienceSettings({ ...DEFAULT_RESILIENCE_SETTINGS, retries: 4, maxConcurrent: 1 });
    expect(resilienceSettings().retries).toBe(4);
    writeFileSync(resilienceSettingsPath(), JSON.stringify({ retries: 1 }));
    const s = resilienceSettings();
    expect(s.retries).toBe(1);
    expect(s.timeoutSeconds).toBe(120);
  });

  it("falls back to the defaults for an unreadable or out-of-range file", () => {
    writeFileSync(resilienceSettingsPath(), "{ nope");
    expect(resilienceSettings()).toEqual(DEFAULT_RESILIENCE_SETTINGS);
    writeFileSync(resilienceSettingsPath(), JSON.stringify({ maxConcurrent: 99 }));
    expect(resilienceSettings()).toEqual(DEFAULT_RESILIENCE_SETTINGS);
  });

  it("rejects values outside the allowed range or not whole numbers", () => {
    const ok = (o: Record<string, unknown>) => ResilienceSettingsSchema.safeParse(o).success;
    expect(ok({ timeoutSeconds: 4 })).toBe(false);
    expect(ok({ retries: 6 })).toBe(false);
    expect(ok({ retries: 1.5 })).toBe(false);
    expect(ok({ maxConcurrent: 0 })).toBe(false);
    expect(ok({ breakerFailures: 0 })).toBe(false);
    expect(ok({ retries: 0 })).toBe(true);
  });
});
