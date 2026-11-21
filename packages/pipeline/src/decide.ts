/**
 * Step 5 — Decide.
 * Maps posture + permissions to a disposition and optional action/thought.
 */

import type { DirectionPosture, SignalDisposition } from "@mind/core";
import { DirectionPosture as P, SignalDisposition as D, globalSendEnabled } from "@mind/core";
import type { ClassifierOutput } from "./classify.js";

export interface DecideInput {
  posture: DirectionPosture;
  autonomy: string;
  adapterCanSend: boolean;
  confidence: number;
  confidenceMin: number;
  classifierOutput: ClassifierOutput;
  guards: { triggered: boolean };
}

export type DecideOutcome =
  | { disposition: "absorbed"; shouldDraft: true; shouldSend: boolean }
  | { disposition: "promoted"; shouldDraft: false; shouldSend: false }
  | {
      disposition: "escalated";
      shouldDraft: false;
      shouldSend: false;
      /**
       * True when the escalation is because a safe answer is blocked, not
       * because the classifier was unsure. The Thought is created as
       * `disputed` and carries the blocker, instead of a mediocre draft.
       */
      disputed: boolean;
    }
  | { disposition: "filed"; shouldDraft: false; shouldSend: false };

export function decide(input: DecideInput): DecideOutcome {
  const { posture, autonomy, adapterCanSend, confidence, confidenceMin, guards } = input;

  // If confidence is below minimum, escalate regardless of posture.
  if (confidence < confidenceMin && posture !== P.escalate) {
    return {
      disposition: "escalated",
      shouldDraft: false,
      shouldSend: false,
      disputed: false,
    };
  }

  // Confident, but the classifier says it cannot answer: a question or a task
  // whose answer needs authority, private context, or a decision that is mine.
  // Drafting anyway produces the worse failure (a plausible wrong reply), so
  // this becomes a disputed Thought with the blocker attached. Acknowledgements
  // and information are excluded — they need no real answer.
  const classifier = input.classifierOutput;
  const blocked =
    (classifier.signalKind === "question" || classifier.signalKind === "task") &&
    !classifier.answerable &&
    classifier.answerBlocker !== null;
  if (blocked && posture !== P.escalate && posture !== P.surface) {
    return {
      disposition: "escalated",
      shouldDraft: false,
      shouldSend: false,
      disputed: true,
    };
  }

  switch (posture) {
    case P.absorb: {
      const shouldSend =
        autonomy === "send" && adapterCanSend && globalSendEnabled() && !guards.triggered;
      return { disposition: "absorbed", shouldDraft: true, shouldSend };
    }

    case P.draft:
      return { disposition: "absorbed", shouldDraft: true, shouldSend: false };

    case P.surface:
      return { disposition: "promoted", shouldDraft: false, shouldSend: false };

    case P.escalate:
      return {
        disposition: "escalated",
        shouldDraft: false,
        shouldSend: false,
        disputed: false,
      };
  }
}
