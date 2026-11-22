import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SENSITIVE_SETTINGS,
  SensitiveSettingsSchema,
  sensitiveSettings,
  sensitiveSettingsPath,
  writeSensitiveSettings,
} from "./sensitive-settings.js";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env["MIND_CONFIG_DIR"];
  process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-sens-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env["MIND_CONFIG_DIR"];
  else process.env["MIND_CONFIG_DIR"] = previous;
});

describe("sensitive topics settings", () => {
  it("defaults to legal, financial, and health, all on, each with keywords", () => {
    const s = sensitiveSettings();
    expect(s.topics.map((t) => t.name)).toEqual(["legal", "financial", "health"]);
    for (const t of s.topics) {
      expect(t.enabled).toBe(true);
      expect(t.keywords.length).toBeGreaterThan(3);
    }
    expect(s).toEqual(DEFAULT_SENSITIVE_SETTINGS);
  });

  it("saves and reads back the operator's own list", () => {
    writeSensitiveSettings({
      topics: [
        { name: "immigration", keywords: ["visa", "green card"], enabled: true },
        { name: "legal", keywords: ["lawsuit"], enabled: false },
      ],
    });
    const s = sensitiveSettings();
    expect(s.topics.map((t) => t.name)).toEqual(["immigration", "legal"]);
    expect(s.topics[1]?.enabled).toBe(false);
  });

  it("allows an empty list, which turns the keyword check off", () => {
    writeSensitiveSettings({ topics: [] });
    expect(sensitiveSettings().topics).toEqual([]);
  });

  it("falls back to the defaults when the file is unreadable or invalid", () => {
    writeFileSync(sensitiveSettingsPath(), "{ not json");
    expect(sensitiveSettings()).toEqual(DEFAULT_SENSITIVE_SETTINGS);
    writeFileSync(sensitiveSettingsPath(), JSON.stringify({ topics: [{ name: "" }] }));
    expect(sensitiveSettings()).toEqual(DEFAULT_SENSITIVE_SETTINGS);
  });

  it("rejects bad topics: empty name, no keywords, duplicate names, too many", () => {
    const parse = (topics: unknown) => SensitiveSettingsSchema.safeParse({ topics }).success;
    expect(parse([{ name: "", keywords: ["a1"], enabled: true }])).toBe(false);
    expect(parse([{ name: "x", keywords: [], enabled: true }])).toBe(false);
    expect(
      parse([
        { name: "x", keywords: ["aa"], enabled: true },
        { name: "X", keywords: ["bb"], enabled: true },
      ]),
    ).toBe(false);
    expect(
      parse(
        Array.from({ length: 31 }, (_, i) => ({ name: `t${i}`, keywords: ["aa"], enabled: true })),
      ),
    ).toBe(false);
    expect(parse([{ name: "ok", keywords: ["visa"], enabled: true }])).toBe(true);
  });
});
