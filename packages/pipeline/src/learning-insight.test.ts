import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateLearningInsight } from "./learning-insight.js";
import type { DirectionProposal } from "./learning-loop.js";

// Same isolation pattern as classify.test.ts: force a cloud provider with
// no key present so aiConfigured() is reliably false, regardless of any
// real ai.json on the machine running these tests.
vi.mock("@mind/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mind/core")>();
  return {
    ...actual,
    aiProvider: () => (process.env["MIND_AI_PROVIDER"] as any) ?? "openai",
    loadApiKey: () => undefined,
    aiConfigured: () => process.env["MIND_TEST_AI_CONFIGURED"] === "true",
  };
});

const sampleProposal: DirectionProposal = {
  kind: "narrow",
  directionId: "work/boss",
  field: "confidenceMin",
  currentValue: 0.7,
  proposedValue: 0.75,
  rationale: "Override rate 30% over 10 actions exceeds 20% threshold.",
  evidence: { total: 10, discarded: 3, sent: 7, overrideRate: 0.3 },
};

describe("generateLearningInsight (no provider configured)", () => {
  const savedProvider = process.env["MIND_AI_PROVIDER"];
  const savedConfigured = process.env["MIND_TEST_AI_CONFIGURED"];

  beforeEach(() => {
    process.env["MIND_AI_PROVIDER"] = "openai";
    process.env["MIND_TEST_AI_CONFIGURED"] = "false";
    delete process.env["OPENAI_API_KEY"];
  });

  afterEach(() => {
    if (savedProvider === undefined) delete process.env["MIND_AI_PROVIDER"];
    else process.env["MIND_AI_PROVIDER"] = savedProvider;
    if (savedConfigured === undefined) delete process.env["MIND_TEST_AI_CONFIGURED"];
    else process.env["MIND_TEST_AI_CONFIGURED"] = savedConfigured;
  });

  it("returns null when there are no proposals, regardless of provider state", async () => {
    const result = await generateLearningInsight([]);
    expect(result).toBeNull();
  });

  it("returns null when no AI provider is configured", async () => {
    const result = await generateLearningInsight([sampleProposal]);
    expect(result).toBeNull();
  });
});
