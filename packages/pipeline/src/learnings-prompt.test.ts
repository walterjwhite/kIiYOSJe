import { beforeEach, describe, expect, it, vi } from "vitest";
import { classify } from "./classify.js";
import { draft } from "./draft.js";

const prompts: string[] = [];

vi.mock("@mind/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mind/core")>();
  return { ...actual, aiConfigured: () => true };
});

vi.mock("./model.js", () => ({
  generateStructured: async (_schema: unknown, req: { prompt: string }) => {
    prompts.push(req.prompt);
    return {
      confidence: 0.9,
      intent: "x",
      signalKind: "question",
      urgency: "low",
      commitment: null,
      commitmentDueDate: null,
      escalateBy: null,
      sensitiveTopics: [],
      answerable: true,
      answerBlocker: null,
    };
  },
  generateReply: async (req: { prompt: string }) => {
    prompts.push(req.prompt);
    return "reply";
  },
}));

const LEARNINGS = "Operator learnings.\n<learnings>\n## Tone\nBe brief.\n</learnings>\n";

beforeEach(() => {
  prompts.length = 0;
});

describe("learnings in prompts", () => {
  const base = {
    signalBody: "hello",
    sender: "a@example.com",
    standard: "s",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("classify adds learnings, and the prompt is unchanged without them", async () => {
    await classify(base);
    await classify({ ...base, learnings: "" });
    await classify({ ...base, learnings: LEARNINGS });
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).not.toContain("<learnings>");
    expect(prompts[2]).toContain("Be brief.");
  });

  it("draft adds learnings, and the prompt is unchanged without them", async () => {
    const classifierOutput = await classify(base);
    prompts.length = 0;
    const input = { senderBody: "hello", sender: "a@example.com", standard: "s", classifierOutput };
    await draft(input);
    await draft({ ...input, learnings: "" });
    await draft({ ...input, learnings: LEARNINGS });
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).not.toContain("<learnings>");
    expect(prompts[2]).toContain("Be brief.");
  });
});
