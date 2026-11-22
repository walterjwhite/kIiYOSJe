/**
 * Step 4 — Classify.
 * Calls the configured model for structured classification output through the
 * model transport (AI SDK for HTTP providers, ACP for Kiro/Copilot CLI).
 *
 * Uses the cheap/fast model (MIND_CLASSIFY_MODEL / ai.json classifyModel).
 * Falls back to a zero-confidence stub only when no provider is configured
 * at all (no key and not ollama). Ollama requires no key and is the default
 * provider, so classify() calls a real model out of the box at zero cost.
 */

import { ModelDeferral, deferralReason, describeModelError } from "./resilience.js";
import {
  ClassifierOutputSchema,
  aiConfigured,
  aiProvider,
  contextTokens,
  logger,
} from "@mind/core";
import type { z } from "zod";
import { bodyBudget, fitToTokens, withShrinkingBody } from "./fit.js";
import { generateStructured } from "./model.js";
import type { ModelTrace } from "./model.js";

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export interface ClassifyInput {
  signalBody: string;
  sender: string;
  standard: string | null;
  /** The signal's receivedAt — used to ground relative deadlines ("by Friday") to an absolute date. */
  receivedAt: Date;
  /** Matched direction's matchPrompt, if any — how it recognizes a match, for context only. */
  matchPrompt?: string | null;
  /** Operator learnings for this stage (learnings.ts), already delimited. Empty or absent adds nothing. */
  learnings?: string;
  /** Receives a trace of the model call (timing, model, provider). */
  onTrace?: (trace: ModelTrace) => void;
}

/** Room kept for the classifier's JSON answer. */
const CLASSIFY_ANSWER_TOKENS = 400;

const SYSTEM = `You are a signal classifier for a local attention-management system.
Your job is to read an incoming message and return structured metadata.

Be conservative:
- Lower confidence when uncertain.
- Never fabricate commitments or deadlines.
- Set answerable=true only if the message is a question you can answer directly
  from general knowledge, or a task that is clearly defined and can be handled
  without human input.
- Set answerable=false if the message involves sensitive topics, requires
  personal authority, or cannot be resolved without information you don't have.`;

function buildPrompt(input: ClassifyInput): string {
  const directionContext = input.standard
    ? `Matched direction standard:\n${input.standard}\n`
    : "No specific direction matched — apply the catch-all standard.\n";
  const matchContext = input.matchPrompt
    ? `How this direction is recognized: ${input.matchPrompt}\n`
    : "";

  return `Current date/time (use this to resolve relative deadlines): ${input.receivedAt.toISOString()}

${directionContext}${matchContext}${input.learnings ? `\n${input.learnings}` : ""}
From: ${input.sender}

Message:
${input.signalBody}

Classify this message and return all required fields.
For escalateBy: if the message contains an explicit deadline (e.g. "by Friday",
"EOD", "within 24 hours"), compute the ISO-8601 datetime relative to the current
date/time given above. Otherwise return null.
For commitment: quote the promise the message makes, in one short sentence, or
return null. A commitment is something someone has undertaken to deliver.
For commitmentDueDate: if a commitment exists and the message gives a date for
it ("I'll send it Friday", "by end of week"), compute that ISO-8601 datetime
the same way. This is the promise date, which is not always the reply deadline.
Return null when no date is given — do not invent one.
For signalKind: question | task | acknowledgement | information | event | other.
For answerBlocker: if answerable=false, name the single thing that blocks an answer.`;
}

export async function classify(input: ClassifyInput): Promise<ClassifierOutput> {
  if (!aiConfigured()) {
    logger.debug({ sender: input.sender }, "classify: no provider configured, returning stub");
    return stub();
  }

  try {
    // The structured answer is short; the rest of the window is for the message.
    const budget = bodyBudget(
      contextTokens(),
      SYSTEM + buildPrompt({ ...input, signalBody: "" }),
      CLASSIFY_ANSWER_TOKENS,
    );
    const object = await withShrinkingBody(budget, (tokens) => {
      const body = fitToTokens(input.signalBody, tokens);
      return generateStructured(ClassifierOutputSchema, {
        system: SYSTEM,
        prompt: buildPrompt({ ...input, signalBody: body.text }),
        operation: "classify",
        omittedChars: body.omittedChars,
        ...(input.onTrace ? { onTrace: input.onTrace } : {}),
      });
    });
    return ClassifierOutputSchema.parse(object);
  } catch (err) {
    // A provider that is down or slow is not a judgement about the message. The
    // caller holds the signal and tries again later (deferred-retry.ts).
    const reason = deferralReason(err);
    if (reason !== null) {
      logger.warn(
        { error: describeModelError(err), provider: aiProvider() },
        "classify: model unavailable, signal will be retried",
      );
      throw new ModelDeferral(reason);
    }
    // A rejected key or an answer that is not valid structure: retrying will not
    // help, so the signal is held for the operator with zero confidence.
    logger.warn(
      { error: describeModelError(err), provider: aiProvider() },
      "classify: LLM call failed, falling back to stub",
    );
    return stub();
  }
}

/** The answer used when the model could not judge a signal. Confidence 0 never absorbs. */
export function unclassified(): ClassifierOutput {
  return stub();
}

function stub(): ClassifierOutput {
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
