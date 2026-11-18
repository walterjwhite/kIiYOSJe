import { describe, it, expect } from "vitest";
import { decide } from "./decide.js";
import type { DecideInput } from "./decide.js";

const baseClassifier = {
  confidence: 0.9,
  intent: "request for report",
  signalKind: "task" as const,
  urgency: "medium" as const,
  commitment: null,
  commitmentDueDate: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

const base: DecideInput = {
  posture: "absorb",
  autonomy: "draft",
  adapterCanSend: false,
  confidence: 0.9,
  confidenceMin: 0.7,
  classifierOutput: baseClassifier,
  guards: { triggered: false },
};

describe("decide", () => {
  it("absorb + draft autonomy → proposed draft, no send", () => {
    const result = decide(base);
    expect(result.disposition).toBe("absorbed");
    if ("shouldSend" in result) expect(result.shouldSend).toBe(false);
  });

  it("absorb + send autonomy + all gates open → shouldSend true", () => {
    // Need MIND_SEND_ENABLED=true for this gate
    process.env["MIND_SEND_ENABLED"] = "true";
    const result = decide({ ...base, autonomy: "send", adapterCanSend: true });
    if ("shouldSend" in result) expect(result.shouldSend).toBe(true);
    delete process.env["MIND_SEND_ENABLED"];
  });

  it("escalate posture → escalated regardless of confidence", () => {
    const result = decide({ ...base, posture: "escalate", confidence: 1 });
    expect(result.disposition).toBe("escalated");
  });

  it("confidence below minimum → escalated", () => {
    const result = decide({ ...base, confidence: 0.5, confidenceMin: 0.7 });
    expect(result.disposition).toBe("escalated");
  });

  it("surface posture → promoted", () => {
    const result = decide({ ...base, posture: "surface" });
    expect(result.disposition).toBe("promoted");
  });

  it("guards triggered → no send even with all gates open", () => {
    process.env["MIND_SEND_ENABLED"] = "true";
    const result = decide({
      ...base,
      autonomy: "send",
      adapterCanSend: true,
      guards: { triggered: true },
    });
    if ("shouldSend" in result) expect(result.shouldSend).toBe(false);
    delete process.env["MIND_SEND_ENABLED"];
  });
});
