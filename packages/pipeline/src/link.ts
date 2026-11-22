/**
 * Auto-link — decide which Goal (a Thought in the "goal" state), if any, a new signal belongs to.
 *
 * The model proposes; `chooseLink` is the gate. A link is made only when the
 * model names a Goal that really exists and its confidence meets the operator's
 * threshold. Anything else leaves the signal unlinked.
 */

import { DATA_RULE, untrusted } from "./prompt-data.js";
import { describeModelError } from "./resilience.js";
import { aiConfigured, contextTokens, logger } from "@mind/core";
import { z } from "zod";
import { bodyBudget, fitToTokens, withShrinkingBody } from "./fit.js";
import type { Candidate } from "./link-candidates.js";
import type { ModelTrace } from "./model.js";
import { generateStructured } from "./model.js";

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

/** Recorded on each automatic link so a change in behaviour can be traced to a prompt change. */
export const LINK_PROMPT_VERSION = 3;

/** Pure gate: only a known Goal at or above the threshold becomes a link. */
export function chooseLink(
  output: LinkOutput | null,
  goals: readonly { readonly id: string }[],
  threshold: number,
): LinkDecision | null {
  if (!output?.thoughtId) return null;
  if (output.confidence < threshold) return null;
  if (!goals.some((g) => g.id === output.thoughtId)) return null;
  return { thoughtId: output.thoughtId, confidence: output.confidence };
}

/** The answer is an id and a number. */
const LINK_ANSWER_TOKENS = 100;

const SYSTEM = `You match an incoming message to one of a few candidate Goals, or to none.
The candidates were shortlisted by similarity, so none of them may be right.
Be conservative: a wrong link hides a message inside the wrong piece of work.
- Answer with a Goal id only when the message is clearly about that Goal's subject.
- Messages the operator linked to a Goal by hand are the strongest evidence of what belongs there.
- "same sender" means the operator has linked a message from this sender to that Goal. It makes it likelier, not certain.
- A sub-goal is shown as "Parent > Sub-goal". Prefer the more specific one when the message fits it.
- Return null when no candidate clearly fits, or when two fit about equally well.
- Confidence is how sure you are, from 0 to 1. Use below 0.5 when guessing.
- Ids must be copied exactly from the list.

${DATA_RULE}`;

export interface LinkInput {
  signalBody: string;
  sender: string;
  subject: string | null;
  /** The shortlist from `rankGoals`, best first. */
  candidates: readonly Candidate[];
  onTrace?: (trace: ModelTrace) => void;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function buildPrompt(input: LinkInput): string {
  // Examples carry only the subject of earlier messages, never their senders
  // or bodies: other people's addresses stay out of the prompt.
  const goals = input.candidates
    .map(({ goal, exemplars, sameSender }) => {
      const lines = [
        `- id: ${goal.id}`,
        `  title: ${goal.parentTitle ? `${goal.parentTitle} > ` : ""}${goal.title}`,
        `  notes: ${goal.body.replace(/\s+/g, " ").slice(0, 300)}`,
      ];
      const subjects = exemplars.map((e) => e.subject).filter((s): s is string => !!s);
      if (subjects.length > 0) {
        lines.push(`  linked here by hand: ${subjects.map((s) => `"${clip(s, 80)}"`).join("; ")}`);
      }
      if (sameSender) lines.push("  same sender: yes");
      return lines.join("\n");
    })
    .join("\n");
  return `Candidate goals:\n${goals}\n\nFrom: ${input.sender}\n${input.subject ? `Subject: ${input.subject}\n` : ""}${untrusted(input.signalBody)}\n\nWhich Goal does this message belong to, if any?`;
}

/** Asks the model. Returns null when AI is not configured, there are no Goals, or the call fails. */
export async function proposeLink(input: LinkInput): Promise<LinkOutput | null> {
  if (input.candidates.length === 0 || !aiConfigured()) return null;
  try {
    const budget = bodyBudget(
      contextTokens(),
      SYSTEM + buildPrompt({ ...input, signalBody: "" }),
      LINK_ANSWER_TOKENS,
    );
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
      { error: describeModelError(err) },
      "link: model call failed, leaving the signal unlinked",
    );
    return null;
  }
}
