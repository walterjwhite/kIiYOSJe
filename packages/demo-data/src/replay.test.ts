import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb, signals, writeAiConfig } from "@mind/core";
import { ensureFallbackDirection } from "@mind/pipeline";
import { replayPersona } from "./replay.js";
import type { PersonaScenario } from "./types.js";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-replay-"));

const scenario: PersonaScenario = {
  id: "engineer",
  displayName: "Engineer",
  pitch: "Test scenario.",
  directionFiles: [],
  startAt: new Date("2026-10-26T09:00:00.000Z"),
  signals: [
    {
      atHour: 1,
      era: "historical",
      intent: "routine question",
      signal: {
        adapter: "demo-email",
        externalId: "eng-1",
        threadId: null,
        sender: "priya@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Quick one — what flag disables the flaky suite?",
      },
    },
    {
      atHour: 0,
      era: "live",
      intent: "left for the operator",
      signal: {
        adapter: "demo-email",
        externalId: "eng-2",
        threadId: null,
        sender: "jordan@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Any update on PR #204?",
      },
    },
  ],
};

beforeAll(() => {
  // A cloud provider with no key keeps classify()/draft() on the stub path.
  writeAiConfig({ provider: "openai" });
  delete process.env["OPENAI_API_KEY"];
});

describe("replayPersona", () => {
  it("ingests every signal and reports no model-driven actions", async () => {
    const db = openDb(":memory:");
    ensureFallbackDirection(db);
    const root = mkdtempSync(join(tmpdir(), "mind-directions-"));
    mkdirSync(join(root, "demo", scenario.id), { recursive: true });

    const result = await replayPersona(db, scenario, root);

    expect(result.personaId).toBe("engineer");
    expect(result.signalsIngested).toBe(2);
    expect(result.historicalResolved).toEqual({ sent: 0, discarded: 0 });
    expect(result.liveLeftProposed).toBe(0);
    expect(result.learningProposals).toBe(0);
    expect(db.select().from(signals).all()).toHaveLength(2);
  });
});

