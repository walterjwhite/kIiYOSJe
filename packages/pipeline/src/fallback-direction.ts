/**
 * Fallback (catch-all) direction.
 *
 * Inserted into the database at startup if it doesn't exist.  It matches any
 * signal that no explicit direction covers, and instructs the LLM to:
 *   - answer knowledge questions directly
 *   - ask clarifying questions for task assignments
 *   - acknowledge everything else
 *
 * autonomy is "draft" — responses always go to the review queue.
 * confidenceMin is 0.5 — lower bar because there is no specific scope to match.
 *
 * To disable the fallback: set enabled=false via PUT /directions/system/catch-all
 * To customise the standard: edit the STANDARD constant below and restart.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@mind/core";
import { directions } from "@mind/core";

export const FALLBACK_DIRECTION_ID = "system/catch-all";

const STANDARD = `
You are handling a message that no specific direction covers.

Apply the following logic based on what the sender needs:

KNOWLEDGE QUESTIONS (signalKind=question, answerable=true):
  Answer directly and concisely. Cite sources or reasoning if relevant.
  If you are not confident in the answer, say so and explain what would be
  needed to give a reliable answer. Do not guess.

TASK ASSIGNMENTS (signalKind=task):
  If the task is clear: acknowledge receipt, restate what you understand the
  task to be, and state that it has been noted.
  If the task is ambiguous: ask the single most important clarifying question.
  Do not ask multiple questions at once.

ACKNOWLEDGEMENTS (signalKind=acknowledgement):
  Reply with a brief acknowledgement only. No elaboration needed.

INFORMATION (signalKind=information):
  Acknowledge receipt and confirm whether any action is expected.

OTHER:
  Acknowledge the message and state that it has been forwarded for review.

In all cases: be professional and brief. Never commit to a date or action
that has not been explicitly authorised. Never fabricate facts.
`.trim();

export function ensureFallbackDirection(db: Db): void {
  const existing = db
    .select({ id: directions.id })
    .from(directions)
    .where(eq(directions.id, FALLBACK_DIRECTION_ID))
    .get();

  if (existing) return;

  db.insert(directions)
    .values({
      id: FALLBACK_DIRECTION_ID,
      name: "catch-all",
      scopeKind: "topic",   // topic scope with empty value = matches everything
      scopeValue: "",
      posture: "absorb",
      standard: STANDARD,
      autonomy: "draft",
      confidenceMin: 0.5,
      guards: null,
      enabled: true,
      version: 1,
    })
    .run();
}
