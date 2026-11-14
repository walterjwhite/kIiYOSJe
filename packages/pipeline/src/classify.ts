/**
 * Step 4 — Classify.
 * Calls the LLM for structured classification output via the Vercel AI SDK.
 *
 * Uses the cheap/fast model for classification (MIND_CLASSIFY_MODEL).
 * Falls back to a zero-confidence stub when no API key is configured so the
 * rest of the pipeline still runs — signals are escalated rather than lost.
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
Be conservative: when uncertain, lower confidence. Never fabricate commitments.`;

function buildPrompt(input: ClassifyInput): string {
  const directionContext = input.standard
    ? `\nMatched direction standard:\n${input.standard}`
    : "\nNo direction matched.";

  return `From: ${input.sender}${directionContext}

Message:
${input.signalBody}

Classify this message. Return:
- directionId: the matched direction ID (${input.directionId ?? "null — no match"})
- confidence: 0.0–1.0 reflecting how well the message fits the direction standard
- intent: a short phrase describing what the sender wants
- urgency: low | medium | high
- commitment: any explicit promise or deadline in the message (null if none)
- sensitiveTopics: list any sensitive topics present (headcount, budget, legal, external-commitment, personnel)`;
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
  // default: openai
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey: key })(classifyModel());
}

export async function classify(input: ClassifyInput): Promise<ClassifierOutput> {
  const key = loadApiKey();
  if (!key) {
    logger.debug(
      { sender: input.sender },
      "classify: no API key configured, returning stub result",
    );
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
    urgency: "low",
    commitment: null,
    sensitiveTopics: [],
  };
}
