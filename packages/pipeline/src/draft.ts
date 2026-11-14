/**
 * Draft generator.
 * Produces a reply body given a signal, its Direction standard, and classifier output.
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
Return only the reply body — no greeting, no sign-off.`;

function buildPrompt(input: DraftInput): string {
  const co = input.classifierOutput;

  // Vary the drafter instruction based on what the classifier found.
  let taskGuidance = "";
  if (co.signalKind === "question" && co.answerable) {
    taskGuidance = "The classifier believes this question is answerable directly. Provide the answer.";
  } else if (co.signalKind === "question" && !co.answerable) {
    taskGuidance = `This question requires human judgement. Acknowledge receipt and explain why a direct answer isn't available yet${co.answerBlocker ? `: ${co.answerBlocker}` : ""}.`;
  } else if (co.signalKind === "task") {
    taskGuidance = co.answerable
      ? "Acknowledge the task, restate it in one sentence, and confirm it has been noted."
      : `Acknowledge the task and ask the single most important clarifying question. Blocker: ${co.answerBlocker ?? "unclear scope"}.`;
  } else if (co.signalKind === "acknowledgement") {
    taskGuidance = "Reply with a brief acknowledgement only.";
  } else if (co.signalKind === "information") {
    taskGuidance = "Acknowledge receipt. If action is implied, state it has been noted.";
  }

  return `Direction standard:
${input.standard}

Classifier notes:
  kind: ${co.signalKind}
  intent: ${co.intent}
  urgency: ${co.urgency}
  answerable: ${co.answerable}
  commitment detected: ${co.commitment ?? "none"}

Task guidance: ${taskGuidance}

Original message from ${input.sender}:
${input.senderBody}

Write a reply that satisfies the standard and the task guidance above.`;
}

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
    logger.debug("draft: no API key configured, skipping");
    return null;
  }

  try {
    const model = await buildModel(key);
    const { text } = await generateText({
      model,
      system: SYSTEM,
      prompt: buildPrompt(input),
    });
    return text;
  } catch (err) {
    logger.warn({ err }, "draft: LLM call failed");
    return null;
  }
}
