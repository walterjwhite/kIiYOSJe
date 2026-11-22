import { describe, expect, it } from "vitest";
import { containsPhrase, stemWords } from "./text-match.js";

describe("stemWords", () => {
  it("lowercases, splits on punctuation, and stems inflections to one form", () => {
    expect(stemWords("Invoices, INVOICING; invoice!")).toEqual(["invoic", "invoic", "invoic"]);
  });

  it("keeps non-Latin words and numbers as words", () => {
    expect(stemWords("Café 42 日本語")).toContain("42");
    expect(stemWords("Café 42 日本語").length).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing for empty or punctuation-only text", () => {
    expect(stemWords("")).toEqual([]);
    expect(stemWords("... ---")).toEqual([]);
  });
});

describe("containsPhrase", () => {
  it("matches a phrase across inflections", () => {
    expect(containsPhrase("Approving budgets is on the agenda.", "approve budget")).toBe(true);
    expect(containsPhrase("We are sending Invoices today", "send invoice")).toBe(true);
  });

  it("requires the words to be adjacent and in order", () => {
    expect(containsPhrase("Approve the budget", "approve budget")).toBe(false);
    expect(containsPhrase("budget approve", "approve budget")).toBe(false);
  });

  it("matches whole words, not fragments inside other words", () => {
    expect(containsPhrase("A billion dollars", "bill")).toBe(false);
    expect(containsPhrase("Take a taxi", "tax")).toBe(false);
    expect(containsPhrase("Your tax return", "tax")).toBe(true);
  });

  it("never matches an empty phrase", () => {
    expect(containsPhrase("anything", "")).toBe(false);
    expect(containsPhrase("anything", "   ")).toBe(false);
  });
});
