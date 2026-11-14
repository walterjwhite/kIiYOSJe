import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classify } from "./classify.js";

// Isolate from real API calls — if no key, stub must run.
describe("classify (no API key)", () => {
  beforeEach(() => {
    // Ensure no key leaks from the environment.
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  });

  it("returns a stub result with confidence 0 when no key is configured", async () => {
    const result = await classify({
      signalBody: "Can you review the budget plan?",
      sender: "alice@example.com",
      directionId: "work/boss",
      standard: "Acknowledge same day.",
    });

    expect(result.confidence).toBe(0);
    expect(result.directionId).toBe("work/boss");
    expect(result.commitment).toBeNull();
    expect(result.sensitiveTopics).toBeInstanceOf(Array);
  });

  it("preserves directionId null in stub", async () => {
    const result = await classify({
      signalBody: "Hello",
      sender: "unknown@example.com",
      directionId: null,
      standard: null,
    });

    expect(result.directionId).toBeNull();
  });
});
