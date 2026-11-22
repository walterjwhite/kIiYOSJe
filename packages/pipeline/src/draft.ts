/**
 * Draft generator.
 * Produces a reply body given a signal, its Direction standard, and classifier output.
 * Uses the larger model (MIND_DRAFT_MODEL / ai.json draftModel) through the
 * model transport (AI SDK for HTTP providers, ACP for Kiro/Copilot CLI).
 * Returns null only when no provider is configured at all.
 */

import { describeModelError } from "./resilience.js";
import { aiConfigured, aiProvider, contextTokens, logger } from "@mind/core";
import type { ClassifierOutput } from "./classify.js";
import { bodyBudget, fitToTokens, withShrinkingBody } from "./fit.js";
import { generateReply } from "./model.js";
import type { ModelTrace } from "./model.js";

export interface DraftInput {
  senderBody: string;
  sender: string;
  standard: string;
  classifierOutput: ClassifierOutput;
  /** Matched direction's responsePrompt, if any — specific handling guidance beyond `standard`. */
  responsePrompt?: string | null;
  /** Operator learnings for this stage (learnings.ts), already delimited. Empty or absent adds nothing. */
  learnings?: string;
  /** Receives a trace of the model call (timing, model, provider). */
  onTrace?: (trace: ModelTrace) => void;
}

/** Room kept for the reply itself. */
const DRAFT_ANSWER_TOKENS = 800;

const SYSTEM = `You are a professional assistant drafting replies on behalf of the message recipient.
Follow the direction standard exactly. Be concise. Never commit to dates not given.
Return only the reply body — no greeting, no sign-off.`;

function buildPrompt(input: DraftInput): string {
  const co = input.classifierOutput;

  // Vary the drafter instruction based on what the classifier found.
  let taskGuidance = "";
  if (co.signalKind === "question" && co.answerable) {
    taskGuidance =
      "The classifier believes this question is answerable directly. Provide the answer.";
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
${input.responsePrompt ? `\nAdditional response guidance for this direction:\n${input.responsePrompt}\n` : ""}${input.learnings ? `\n${input.learnings}` : ""}
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

export async function draft(input: DraftInput): Promise<string | null> {
  if (!aiConfigured()) {
    logger.debug("draft: no provider configured, skipping");
    return null;
  }

  try {
    const budget = bodyBudget(
      contextTokens(),
      SYSTEM + buildPrompt({ ...input, senderBody: "" }),
      DRAFT_ANSWER_TOKENS,
    );
    const text = await withShrinkingBody(budget, (tokens) => {
      const body = fitToTokens(input.senderBody, tokens);
      return generateReply({
        system: SYSTEM,
        prompt: buildPrompt({ ...input, senderBody: body.text }),
        operation: "draft",
        omittedChars: body.omittedChars,
        ...(input.onTrace ? { onTrace: input.onTrace } : {}),
      });
    });
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn(
      { error: describeModelError(err), provider: aiProvider() },
      "draft: LLM call failed",
    );
    return null;
  }
}
