import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { transform } from "./transform.js";

// Same isolation pattern as classify.test.ts/learning-insight.test.ts: force
// a cloud provider with no key present so aiConfigured() is reliably false,
// regardless of any real ai.json on the machine running these tests.
vi.mock("@mind/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mind/core")>();
  return {
    ...actual,
    aiProvider: () => (process.env["MIND_AI_PROVIDER"] as any) ?? "openai",
    loadApiKey: () => undefined,
    aiConfigured: () => process.env["MIND_TEST_AI_CONFIGURED"] === "true",
  };
});

describe("transform (no provider configured)", () => {
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

  it("returns null when no AI provider is configured", async () => {
    const result = await transform({
      signalBody: "A new sign-in on your Google Account.",
      subject: "Security alert",
      sender: "no-reply@accounts.google.com",
      transformPrompt:
        "Rewrite as: Google Account Sign-on on <platform> for <account-email> - <recovery-email>",
    });
    expect(result).toBeNull();
  });
});
