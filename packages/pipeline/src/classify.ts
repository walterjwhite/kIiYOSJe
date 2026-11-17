/**
 * Step 4 — Classify.
 * Calls the LLM for structured classification output via the Vercel AI SDK.
 *
 * Uses the cheap/fast model (MIND_CLASSIFY_MODEL / ai.json classifyModel).
 * Falls back to a zero-confidence stub only when no provider is configured
 * at all (no key and not ollama). Ollama requires no key and is the default
 * provider, so classify() calls a real model out of the box at zero cost.
 */

import { generateObject } from "ai";
import { z } from "zod";
import {
  ClassifierOutputSchema,
  loadApiKey,
  aiProvider,
  aiBaseUrl,
  aiConfigured,
  classifyModel,
  logger,
} from "@mind/core";

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export interface ClassifyInput {
  signalBody: string;
  sender: string;
  standard: string | null;
  /** The signal's receivedAt — used to ground relative deadlines ("by Friday") to an absolute date. */
  receivedAt: Date;
  /** Matched direction's matchPrompt, if any — how it recognizes a match, for context only. */
  matchPrompt?: string | null;
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
  const matchContext = input.matchPrompt
    ? `How this direction is recognized: ${input.matchPrompt}\n`
    : "";

  return `Current date/time (use this to resolve relative deadlines): ${input.receivedAt.toISOString()}

${directionContext}${matchContext}
From: ${input.sender}

Message:
${input.signalBody}

Classify this message and return all required fields.
For escalateBy: if the message contains an explicit deadline (e.g. "by Friday",
"EOD", "within 24 hours"), compute the ISO-8601 datetime relative to the current
date/time given above. Otherwise return null.
For signalKind: question | task | acknowledgement | information | other.
For answerBlocker: if answerable=false, name the single thing that blocks an answer.`;
}

async function buildModel() {
  const provider = aiProvider();

  if (provider === "ollama") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    // Ollama's OpenAI-compatible endpoint accepts any non-empty apiKey value.
    return createOpenAI({ baseURL: aiBaseUrl(), apiKey: "ollama" })(classifyModel());
  }

  const key = loadApiKey();
  if (!key) throw new Error(`No API key configured for provider '${provider}'`);

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
  if (!aiConfigured()) {
    logger.debug({ sender: input.sender }, "classify: no provider configured, returning stub");
    return stub();
  }

  try {
    const model = await buildModel();
    const { object } = await generateObject({
      model,
      schema: ClassifierOutputSchema,
      system: SYSTEM,
      prompt: buildPrompt(input),
    });
    return object;
  } catch (err) {
    logger.warn(
      { err, sender: input.sender, provider: aiProvider() },
      "classify: LLM call failed, falling back to stub",
    );
    return stub();
  }
}

function stub(): ClassifierOutput {
  return {
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
