/**
 * Transform — an optional rewrite of a matched signal's display summary.
 *
 * Some signals are correctly classified and need no response, but are
 * still tedious to read at a glance: "A new sign-in on your Google
 * Account" tells you nothing until you open it. A Direction's
 * transformPrompt describes how to rewrite that into something that
 * actually says what happened — e.g. naming the platform and account —
 * without changing the signal's disposition, routing, or stored body.
 *
 * This never replaces the original. `signals.transformedSummary` is a
 * separate column; the original body and subject are untouched and
 * always one click away in the extension. If no transformPrompt is set,
 * or no provider is configured, nothing is generated — same
 * degrade-quietly behaviour as classify()/draft().
 */

import { aiConfigured, aiProvider, logger } from "@mind/core";
import { generateReply } from "./model.js";

export interface TransformInput {
  signalBody: string;
  subject?: string | null;
  sender: string;
  /** The matched direction's transformPrompt — required; callers should not call this when it's absent. */
  transformPrompt: string;
}

const SYSTEM = `You rewrite a message into a short, plain-language summary for someone
scanning a list of many signals. Follow the rewrite instructions exactly. State only what
the instructions ask for, filled in from the actual message — never invent a value that
isn't in the message. One line, no greeting, no explanation of what you did.`;

function buildPrompt(input: TransformInput): string {
  return `Rewrite instructions:
${input.transformPrompt}

From: ${input.sender}
${input.subject ? `Subject: ${input.subject}\n` : ""}
Message:
${input.signalBody}

Produce the rewritten one-line summary described by the instructions above.`;
}

export async function transform(input: TransformInput): Promise<string | null> {
  if (!aiConfigured()) {
    logger.debug("transform: no provider configured, skipping");
    return null;
  }

  try {
    const text = await generateReply({ system: SYSTEM, prompt: buildPrompt(input) });
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err, provider: aiProvider() }, "transform: LLM call failed");
    return null;
  }
}
