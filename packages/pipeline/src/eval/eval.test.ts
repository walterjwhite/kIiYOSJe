import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixtures, parseFixtures } from "./fixtures.js";
import { formatJson, formatReport } from "./report.js";
import { runEval } from "./runner.js";

const FIXED_DATE = () => new Date("2026-03-02T12:00:00.000Z");

let sendEnabled: string | undefined;
beforeEach(() => {
  sendEnabled = process.env["MIND_SEND_ENABLED"];
});
afterEach(() => {
  if (sendEnabled === undefined) delete process.env["MIND_SEND_ENABLED"];
  else process.env["MIND_SEND_ENABLED"] = sendEnabled;
});

describe("fixtures", () => {
  it("has at least 20 labelled fixtures with unique ids", () => {
    const fixtures = loadFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
  });

  it("uses only .test addresses", () => {
    const text = JSON.stringify(loadFixtures());
    const addresses = text.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const a of addresses) expect(a).toMatch(/\.test$/);
  });

  it("names the file and the problem when a fixture is invalid", () => {
    const bad = JSON.stringify([{ id: "x", note: "n", signal: { sender: "a@b.test", body: "b" } }]);
    expect(() => parseFixtures(bad, "fixtures.json")).toThrow(/fixtures\.json: 0\.recorded/);
    expect(() => parseFixtures("{", "fixtures.json")).toThrow(/fixtures\.json: not valid JSON/);
  });

  it("rejects a duplicate id", () => {
    const one = loadFixtures()[0];
    expect(() => parseFixtures(JSON.stringify([one, one]), "dup.json")).toThrow(/duplicate/);
  });
});

describe("evaluation run with recorded model output", () => {
  it("meets the floors and every counted fixture matches its label", async () => {
    const report = await runEval(loadFixtures(), { now: FIXED_DATE });
    const m = report.metrics;

    expect(m.failures).toEqual([]);
    expect(m.surfaceRecall).not.toBeNull();
    expect(m.surfaceRecall ?? 0).toBeGreaterThanOrEqual(0.95);
    expect(m.falseAbsorbRate ?? 1).toBeLessThanOrEqual(0.02);
    expect(m.gateViolations).toBe(0);
    expect(m.directionAccuracy).toBe(1);
  });

  it("reports known gaps separately and does not count them", async () => {
    const report = await runEval(loadFixtures(), { now: FIXED_DATE });
    expect(report.metrics.known.length).toBeGreaterThan(0);
    expect(report.metrics.counted + report.metrics.known.length).toBe(report.fixtures);
  });

  it("closes the send gate even when the environment opens it, and restores it", async () => {
    process.env["MIND_SEND_ENABLED"] = "true";
    const report = await runEval(loadFixtures(), { now: FIXED_DATE });
    expect(report.metrics.gateViolations).toBe(0);
    expect(process.env["MIND_SEND_ENABLED"]).toBe("true");
  });

  it("flags a fixture whose label the pipeline disagrees with", async () => {
    const fixtures = loadFixtures().map((f) =>
      f.id === "boss-schedule-routine" ? { ...f, expected: { ...f.expected, surfaced: true } } : f,
    );
    const report = await runEval(fixtures, { now: FIXED_DATE });
    expect(report.metrics.failures.map((f) => f.id)).toEqual(["boss-schedule-routine"]);
    expect(report.metrics.surfaceRecall ?? 1).toBeLessThan(1);
  });

  it("records an error for a fixture when the Directions folder is missing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "mind-eval-"));
    writeFileSync(join(empty, "README"), "no directions here");
    const report = await runEval(loadFixtures().slice(0, 2), {
      directionsDir: join(empty, "missing"),
      now: FIXED_DATE,
    });
    // Without Directions every signal falls to the catch-all, which the labels do not expect.
    expect(report.metrics.failures.length).toBeGreaterThan(0);
  });
});

describe("report", () => {
  it("prints the metrics, the model, and the date", async () => {
    const report = await runEval(loadFixtures(), { now: FIXED_DATE });
    const text = formatReport(report);
    expect(text).toContain("Evaluation, 2026-03-02");
    expect(text).toContain("Model: stub (recorded output)");
    expect(text).toContain("Surface recall");
    expect(text).toContain("Gate violations     0");
    expect(text).toContain("Known gaps (not counted):");
  });

  it("emits JSON without per-fixture outcomes", async () => {
    const report = await runEval(loadFixtures(), { now: FIXED_DATE });
    const json = JSON.parse(formatJson(report)) as Record<string, unknown>;
    expect(json["model"]).toBe("stub (recorded output)");
    expect(json["outcomes"]).toBeUndefined();
    expect((json["metrics"] as { gateViolations: number }).gateViolations).toBe(0);
  });
});
