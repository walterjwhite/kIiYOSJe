/**
 * Step 4 — Classify.
 * Calls the LLM for structured classification output via the Vercel AI SDK.
 *
 * Uses the cheap/fast model (MIND_CLASSIFY_MODEL).
 * Falls back to a zero-confidence stub when no API key is configured.
 */

import { generateObject } from "ai";
import { z } from "zod";
import {
  ClassifierOutputSchema,
  loadApiKey,
  aiProvider,
  classifyModel,
  logger,
} from "@mind/core";

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export interface ClassifyInput {
  signalBody: string;
  sender: string;
  directionId: string | null;
  standard: string | null;
}

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

  return `${directionContext}
From: ${input.sender}

Message:
${input.signalBody}

Classify this message and return all required fields.
For escalateBy: if the message contains an explicit deadline (e.g. "by Friday",
"EOD", "within 24 hours"), compute the ISO-8601 datetime. Otherwise return null.
For signalKind: question | task | acknowledgement | information | other.
For answerBlocker: if answerable=false, name the single thing that blocks an answer.`;
}

async function buildModel(key: string) {
  const provider = aiProvider();

  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: key })(classifyModel());
  }
  if (provider === "google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({ apiKey: key })(classifyModel());
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey: key })(classifyModel());
}

export async function classify(input: ClassifyInput): Promise<ClassifierOutput> {
  const key = loadApiKey();
  if (!key) {
    logger.debug({ sender: input.sender }, "classify: no API key configured, returning stub");
    return stub(input);
  }

  try {
    const model = await buildModel(key);
    const { object } = await generateObject({
      model,
      schema: ClassifierOutputSchema,
      system: SYSTEM,
      prompt: buildPrompt(input),
    });
    return object;
  } catch (err) {
    logger.warn({ err, sender: input.sender }, "classify: LLM call failed, falling back to stub");
    return stub(input);
  }
}

function stub(input: ClassifyInput): ClassifierOutput {
  return {
    directionId: input.directionId,
    confidence: 0,
    intent: "unclassified — no API key or LLM error",
    signalKind: "other",
    urgency: "low",
    commitment: null,
    escalateBy: null,
    sensitiveTopics: [],
    answerable: false,
    answerBlocker: "classifier not configured",
  };
}
