import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_PERSONAS,
  demoDbPath,
  demoPersonas,
  resetDemoDb,
} from "./seed.js";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-demo-"));

describe("ALL_PERSONAS", () => {
  it("covers engineer, pm and devsecops with scenario metadata", () => {
    expect(ALL_PERSONAS.map((scenario) => scenario.id)).toEqual([
      "engineer",
      "pm",
      "devsecops",
    ]);
    for (const scenario of ALL_PERSONAS) {
      expect(scenario.displayName.length).toBeGreaterThan(0);
      expect(scenario.pitch.length).toBeGreaterThan(0);
      expect(scenario.startAt).toBeInstanceOf(Date);
      expect(scenario.signals.length).toBeGreaterThan(0);
    }
  });
});

describe("demoPersonas", () => {
  it("flattens every scenario into the shared persona shape", () => {
    expect(Object.keys(demoPersonas).sort()).toEqual([
      "devsecops",
      "engineer",
      "pm",
    ]);
    for (const scenario of ALL_PERSONAS) {
      const flat = demoPersonas[scenario.id] ?? [];
      expect(flat).toHaveLength(scenario.signals.length);
      for (const signal of flat) {
        expect(signal.externalId.length).toBeGreaterThan(0);
        expect(signal.sender).toContain("@");
        expect(signal.body.length).toBeGreaterThan(0);
        expect(signal.minutesAgo).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("demo database", () => {
  it("lives under the data directory and can be reset", () => {
    const path = demoDbPath();
    expect(path.startsWith(process.env["HOME"] ?? "")).toBe(true);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "db");
    writeFileSync(`${path}-wal`, "wal");
    resetDemoDb();

    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
  });
});
