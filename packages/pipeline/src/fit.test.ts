import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN,
  bodyBudget,
  condense,
  estimateTokens,
  fitToTokens,
  isContextOverflow,
  withShrinkingBody,
} from "./fit.js";

describe("condense", () => {
  it("drops invisible padding, tracking URLs and encoded blobs", () => {
    const text = `Hello\u200b\u200c \u034f\ufeffthere ${"https://t.example.com/track?x=" + "a".repeat(80)} ${"QUJD".repeat(60)}`;
    expect(condense(text)).toBe("Hello there [link] [data]");
  });
  it("keeps short links and normal words", () => {
    expect(condense("See https://example.com/a now")).toBe("See https://example.com/a now");
  });
  it("collapses runs of blank space", () => {
    expect(condense("a  \t b\n\n\n\n\nc \n d")).toBe("a b\n\nc\nd");
  });
});

describe("fitToTokens", () => {
  it("returns a short message unchanged", () => {
    expect(fitToTokens("Can you review this?", 500)).toEqual({ text: "Can you review this?", omittedChars: 0 });
  });

  it("cuts a long message in the middle, keeping its start and its end", () => {
    const text = `START ${"filler ".repeat(20_000)} FINAL-QUESTION?`;
    const fitted = fitToTokens(text, 1000);
    expect(fitted.text.startsWith("START")).toBe(true);
    expect(fitted.text.endsWith("FINAL-QUESTION?")).toBe(true);
    expect(fitted.omittedChars).toBeGreaterThan(100_000);
    expect(fitted.text).toContain("characters omitted");
    expect(estimateTokens(fitted.text)).toBeLessThanOrEqual(1000 + 30);
  });

  it("never shrinks below a floor, however small the budget", () => {
    expect(fitToTokens("x ".repeat(5000), 1).text.length).toBeGreaterThan(200 * CHARS_PER_TOKEN - 10);
  });
});

describe("bodyBudget", () => {
  it("leaves room for the instructions and the answer", () => {
    // 4096 window: 10% margin, 600 token scaffold (1800 chars), 400 token answer.
    expect(bodyBudget(4096, "x".repeat(1800), 400)).toBe(Math.floor(4096 * 0.9) - 600 - 400);
  });
  it("still allows a minimum when the window is tiny", () => {
    expect(bodyBudget(512, "x".repeat(3000), 400)).toBe(200);
  });
});

describe("the reported failure", () => {
  it("a 23,602 token message fits a 4096 token window once budgeted", () => {
    const message = "word ".repeat(23_602 * 4); // about 23.6k tokens of English
    const scaffold = "x".repeat(1500);
    const budget = bodyBudget(4096, scaffold, 400);
    const total = estimateTokens(scaffold) + estimateTokens(fitToTokens(message, budget).text) + 400;
    expect(total).toBeLessThanOrEqual(4096);
  });
});

describe("isContextOverflow", () => {
  it.each([
    "request (23602 tokens) exceeds the available context size (4096 tokens)",
    "This model's maximum context length is 8192 tokens",
    "too many tokens",
  ])("recognises %j", (message) => expect(isContextOverflow(new Error(message))).toBe(true));
  it("ignores unrelated errors", () => {
    expect(isContextOverflow(new Error("connect ECONNREFUSED"))).toBe(false);
  });
});

describe("withShrinkingBody", () => {
  it("retries once with half the budget after an overflow", async () => {
    const seen: number[] = [];
    const result = await withShrinkingBody(1000, async (b) => {
      seen.push(b);
      if (b === 1000) throw new Error("exceeds the available context size");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(seen).toEqual([1000, 500]);
  });
  it("does not retry other errors", async () => {
    let calls = 0;
    await expect(
      withShrinkingBody(1000, async () => {
        calls++;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
  it("gives up after a single retry", async () => {
    let calls = 0;
    await expect(
      withShrinkingBody(1000, async () => {
        calls++;
        throw new Error("exceeds the available context size");
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
