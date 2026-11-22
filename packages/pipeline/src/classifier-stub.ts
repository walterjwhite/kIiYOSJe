import type { ClassifierOutput } from "./classify.js";

/**
 * The answer used when the model could not judge a signal (no provider, a rejected
 * key, an invalid answer, or out of retries). Confidence 0 is below every
 * Direction's minimum, so it is never absorbed, drafted, or sent.
 */
export function unclassified(): ClassifierOutput {
  return {
    confidence: 0,
    intent: "unclassified — no API key or LLM error",
    signalKind: "other",
    urgency: "low",
    commitment: null,
    commitmentDueDate: null,
    escalateBy: null,
    sensitiveTopics: [],
    answerable: false,
    answerBlocker: "classifier not configured",
  };
}
