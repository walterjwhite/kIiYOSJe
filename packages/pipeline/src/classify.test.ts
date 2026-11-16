import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { classify } from "./classify.js";

// Isolate from real API calls — if no provider is configured, stub must run.
// ollama is the default provider and needs no key, so these tests must force
// a cloud provider with no key present to exercise the "not configured" path
// without making a real network call. The ai.json config file is mocked out
// entirely so a real file on the machine running these tests can't leak in.
vi.mock("@mind/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mind/core")>();
  return {
    ...actual,
    aiProvider: () => (process.env["MIND_AI_PROVIDER"] as any) ?? "openai",
    loadApiKey: () => undefined,
    aiConfigured: () => false,
  };
});

describe("classify (no provider configured)", () => {
  const savedProvider = process.env["MIND_AI_PROVIDER"];

  beforeEach(() => {
    process.env["MIND_AI_PROVIDER"] = "openai";
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env["MIND_AI_PROVIDER"];
    } else {
      process.env["MIND_AI_PROVIDER"] = savedProvider;
    }
  });

  it("returns a stub result with confidence 0 when not configured", async () => {
    const result = await classify({
      signalBody: "Can you review the budget plan?",
      sender: "alice@example.com",
      standard: "Acknowledge same day.",
      receivedAt: new Date("2026-01-01T09:00:00.000Z"),
    });

    expect(result.confidence).toBe(0);
    expect(result.commitment).toBeNull();
    expect(result.sensitiveTopics).toBeInstanceOf(Array);
    expect(result.signalKind).toBe("other");
    expect(result.answerable).toBe(false);
    expect(typeof result.escalateBy === "string" || result.escalateBy === null).toBe(true);
  });

  it("returns the stub shape even with a null standard (no matched direction)", async () => {
    const result = await classify({
      signalBody: "Hello",
      sender: "unknown@example.com",
      standard: null,
      receivedAt: new Date("2026-01-01T09:00:00.000Z"),
    });

    expect(result.confidence).toBe(0);
    expect(result.answerBlocker).toBe("classifier not configured");
  });
});
