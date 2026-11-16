import { describe, it, expect } from "vitest";
import { computeEscalateBy } from "./escalation.js";
import type { ClassifierOutput } from "./classify.js";

function makeOutput(overrides: Partial<ClassifierOutput> = {}): ClassifierOutput {
  return {
    confidence: 0.8,
    intent: "test",
    signalKind: "question",
    urgency: "medium",
    commitment: null,
    escalateBy: null,
    sensitiveTopics: [],
    answerable: true,
    answerBlocker: null,
    ...overrides,
  };
}

const BASE_DATE = new Date("2024-01-15T10:00:00.000Z");

describe("computeEscalateBy", () => {
  it("uses explicit classifier deadline when provided", () => {
    const explicit = "2024-01-16T09:00:00.000Z";
    const result = computeEscalateBy(makeOutput({ escalateBy: explicit }), BASE_DATE);
    expect(result).toBe(explicit);
  });

  it("high urgency → 2 hours after receivedAt", () => {
    const result = computeEscalateBy(makeOutput({ urgency: "high" }), BASE_DATE);
    expect(result).toBe("2024-01-15T12:00:00.000Z");
  });

  it("medium urgency → 24 hours after receivedAt", () => {
    const result = computeEscalateBy(makeOutput({ urgency: "medium" }), BASE_DATE);
    expect(result).toBe("2024-01-16T10:00:00.000Z");
  });

  it("low urgency task → 72 hours after receivedAt", () => {
    const result = computeEscalateBy(
      makeOutput({ urgency: "low", signalKind: "task" }),
      BASE_DATE,
    );
    expect(result).toBe("2024-01-18T10:00:00.000Z");
  });

  it("low urgency acknowledgement → null (no deadline needed)", () => {
    const result = computeEscalateBy(
      makeOutput({ urgency: "low", signalKind: "acknowledgement" }),
      BASE_DATE,
    );
    expect(result).toBeNull();
  });

  it("low urgency information → null", () => {
    const result = computeEscalateBy(
      makeOutput({ urgency: "low", signalKind: "information" }),
      BASE_DATE,
    );
    expect(result).toBeNull();
  });

  it("acknowledgement with high urgency still gets a deadline", () => {
    const result = computeEscalateBy(
      makeOutput({ urgency: "high", signalKind: "acknowledgement" }),
      BASE_DATE,
    );
    expect(result).toBe("2024-01-15T12:00:00.000Z");
  });
});
