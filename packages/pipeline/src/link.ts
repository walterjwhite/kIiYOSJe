/**
 * Auto-link — decide which Goal (a Thought in the "goal" state), if any, a new signal belongs to.
 *
 * The model proposes; `chooseLink` is the gate. A link is made only when the
 * model names a Goal that really exists and its confidence meets the operator's
 * threshold. Anything else leaves the signal unlinked.
 */

import { z } from "zod";
import { aiConfigured, contextTokens, logger } from "@mind/core";
import { bodyBudget, fitToTokens, withShrinkingBody } from "./fit.js";
import { generateStructured } from "./model.js";
import type { ModelTrace } from "./model.js";

export interface GoalCandidate {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const LinkOutputSchema = z.object({
  /** The id of the best-fitting Goal, or null when none fits. */
  thoughtId: z.string().nullable(),
  /** 0 to 1: how sure the model is that the signal belongs to that Goal. */
  confidence: z.number().min(0).max(1),
});
export type LinkOutput = z.infer<typeof LinkOutputSchema>;

export interface LinkDecision {
  readonly thoughtId: string;
  readonly confidence: number;
}

/** Pure gate: only a known Goal at or above the threshold becomes a link. */
export function chooseLink(
  output: LinkOutput | null,
  goals: readonly GoalCandidate[],
  threshold: number,
): LinkDecision | null {
  if (!output?.thoughtId) return null;
  if (output.confidence < threshold) return null;
  if (!goals.some((g) => g.id === output.thoughtId)) return null;
  return { thoughtId: output.thoughtId, confidence: output.confidence };
}

const MAX_GOALS_IN_PROMPT = 25;

/** The answer is an id and a number. */
const LINK_ANSWER_TOKENS = 100;

const SYSTEM = `You match an incoming message to one of the operator's Goals, or to none.
Be conservative: a wrong link hides a message inside the wrong piece of work.
- Answer with a Goal id only when the message is clearly about that Goal's subject.
- Return null when no Goal clearly fits, or when two fit about equally well.
- Confidence is how sure you are, from 0 to 1. Use below 0.5 when guessing.
- Ids must be copied exactly from the list.`;

export interface LinkInput {
  signalBody: string;
  sender: string;
  subject: string | null;
  goals: readonly GoalCandidate[];
  onTrace?: (trace: ModelTrace) => void;
}

function buildPrompt(input: LinkInput): string {
  // A long goal list would eat the window the message needs, so cap it.
  const goals = input.goals
    .slice(0, MAX_GOALS_IN_PROMPT)
    .map(
      (g) =>
        `- id: ${g.id}\n  title: ${g.title}\n  notes: ${g.body.replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");
  return `Goals:\n${goals}\n\nFrom: ${input.sender}\n${input.subject ? `Subject: ${input.subject}\n` : ""}Message:\n${input.signalBody}\n\nWhich Goal does this message belong to, if any?`;
}

/** Asks the model. Returns null when AI is not configured, there are no Goals, or the call fails. */
export async function proposeLink(input: LinkInput): Promise<LinkOutput | null> {
  if (input.goals.length === 0 || !aiConfigured()) return null;
  try {
    const budget = bodyBudget(contextTokens(), SYSTEM + buildPrompt({ ...input, signalBody: "" }), LINK_ANSWER_TOKENS);
    return await withShrinkingBody(budget, (tokens) => {
      const body = fitToTokens(input.signalBody, tokens);
      return generateStructured(LinkOutputSchema, {
        system: SYSTEM,
        prompt: buildPrompt({ ...input, signalBody: body.text }),
        operation: "link",
        omittedChars: body.omittedChars,
        ...(input.onTrace ? { onTrace: input.onTrace } : {}),
      });
    });
  } catch (err) {
    logger.warn(
      { err, sender: input.sender },
      "link: model call failed, leaving the signal unlinked",
    );
    return null;
  }
}
