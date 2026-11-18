import { describe, expect, it } from "vitest";
import {
  ClassifierOutputSchema,
  CreateThoughtRequestSchema,
  ReclassifySignalRequestSchema,
  ValidationError,
} from "./schemas.js";

const CLASSIFICATION = {
  confidence: 0.7,
  intent: "status request",
  signalKind: "task",
  urgency: "high",
  commitment: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

describe("ClassifierOutputSchema", () => {
  it("accepts a complete classification", () => {
    const parsed = ClassifierOutputSchema.parse(CLASSIFICATION);
    expect(parsed.signalKind).toBe("task");
    expect(parsed.escalateBy).toBeNull();
  });

  it("rejects an unknown signal kind or urgency", () => {
    expect(() =>
      ClassifierOutputSchema.parse({ ...CLASSIFICATION, signalKind: "incident" }),
    ).toThrow();
    expect(() =>
      ClassifierOutputSchema.parse({ ...CLASSIFICATION, urgency: "urgent" }),
    ).toThrow();
  });

  it("rejects confidence outside 0-1", () => {
    expect(() =>
      ClassifierOutputSchema.parse({ ...CLASSIFICATION, confidence: 1.5 }),
    ).toThrow();
  });
});

describe("HTTP request schemas", () => {
  it("rejects an empty thought title", () => {
    expect(() =>
      CreateThoughtRequestSchema.parse({ title: "", body: "", directionId: null }),
    ).toThrow();
  });

  it("requires a direction id when reclassifying", () => {
    expect(() => ReclassifySignalRequestSchema.parse({})).toThrow();
    expect(ReclassifySignalRequestSchema.parse({ directionId: "work/alice" })).toEqual({
      directionId: "work/alice",
    });
  });
});

describe("ValidationError", () => {
  it("keeps its name so the server can map it to 400", () => {
    const error = new ValidationError("bad input");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ValidationError");
  });
});
