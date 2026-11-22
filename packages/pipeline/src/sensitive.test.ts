import type { SensitiveSettings } from "@mind/core";
import { describe, expect, it } from "vitest";
import { findSensitiveTopics } from "./sensitive.js";

const settings: SensitiveSettings = {
  topics: [
    { name: "legal", keywords: ["lawsuit", "legal action"], enabled: true },
    { name: "financial", keywords: ["tax", "wire transfer"], enabled: true },
    { name: "health", keywords: ["surgery"], enabled: false },
    { name: "immigration", keywords: ["visa"], enabled: true },
  ],
};

describe("findSensitiveTopics", () => {
  it("returns the names of topics whose keywords appear", () => {
    expect(findSensitiveTopics("We may take legal action.", [], settings)).toEqual(["legal"]);
    expect(findSensitiveTopics("Wire transfers need a tax form.", [], settings)).toEqual([
      "financial",
    ]);
  });

  it("matches inflected forms and ignores case", () => {
    expect(findSensitiveTopics("LAWSUITS are pending", [], settings)).toEqual(["legal"]);
  });

  it("matches whole words only", () => {
    expect(findSensitiveTopics("Let us take a taxi to the airport", [], settings)).toEqual([]);
  });

  it("ignores a disabled topic", () => {
    expect(findSensitiveTopics("She needs surgery", [], settings)).toEqual([]);
  });

  it("returns every topic that matches, once each", () => {
    expect(findSensitiveTopics("Visa lawsuit, another lawsuit", [], settings)).toEqual([
      "legal",
      "immigration",
    ]);
  });

  it("also counts a model tag that names an enabled topic", () => {
    expect(findSensitiveTopics("Hello", ["Legal"], settings)).toEqual(["legal"]);
    expect(findSensitiveTopics("Hello", ["health"], settings)).toEqual([]);
    expect(findSensitiveTopics("Hello", ["gardening"], settings)).toEqual([]);
  });

  it("returns nothing for empty text or an empty list", () => {
    expect(findSensitiveTopics("", [], settings)).toEqual([]);
    expect(findSensitiveTopics("lawsuit", [], { topics: [] })).toEqual([]);
  });
});
