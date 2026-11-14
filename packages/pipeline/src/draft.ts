/**
 * Draft generator — produces a reply body given a signal and its Direction standard.
 * Uses the larger model (MIND_DRAFT_MODEL).
 * Returns null if no key is configured; the action is still created with an empty body.
 */

import { generateText } from "ai";
import { loadApiKey, aiProvider, draftModel, logger } from "@mind/core";
import type { ClassifierOutput } from "./classify.js";

export interface DraftInput {
  senderBody: string;
  sender: string;
  standard: string;
  classifierOutput: ClassifierOutput;
}

const SYSTEM = `You are a professional assistant drafting replies on behalf of the message recipient.
Follow the direction standard exactly. Be concise. Never commit to dates not given.
Return only the reply body — no greeting line, no sign-off.`;

async function buildModel(key: string) {
  const provider = aiProvider();

  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: key })(draftModel());
  }
  if (provider === "google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({ apiKey: key })(draftModel());
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey: key })(draftModel());
}

export async function draft(input: DraftInput): Promise<string | null> {
  const key = loadApiKey();
  if (!key) {
    logger.debug("draft: no API key configured, skipping draft generation");
    return null;
  }

  const prompt = `Direction standard:
${input.standard}

Classifier notes:
  intent: ${input.classifierOutput.intent}
  urgency: ${input.classifierOutput.urgency}
  commitment detected: ${input.classifierOutput.commitment ?? "none"}

Original message from ${input.sender}:
${input.senderBody}

Write a reply that satisfies the standard.`;

  try {
    const model = await buildModel(key);
    const { text } = await generateText({
      model,
      system: SYSTEM,
      prompt,
    });
    return text;
  } catch (err) {
    logger.warn({ err }, "draft: LLM call failed");
    return null;
  }
}
