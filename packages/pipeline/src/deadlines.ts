/**
 * Deadline grounding with `chrono-node` (MIT).
 *
 * The classifier is asked for an ISO deadline, and a small model sometimes
 * gets it wrong (it once resolved "by Friday" to 2023). This reads the message
 * itself, with the arrival time as the reference, so a date comes from the text
 * and is never invented. Only a date introduced by a deadline phrase ("by",
 * "before", "due", "no later than", "within") counts, so "can we meet on
 * Thursday?" is not a deadline.
 *
 * Order of trust: a date found in the text, then the model's date if it is
 * plausible, then nothing. Pure. English phrasing only.
 */

import * as chrono from "chrono-node";

/** Longest text read. A deadline is near the top of a message, and this bounds the cost. */
const MAX_TEXT_CHARS = 5_000;
/** How far before a date a cue word may sit. */
const CUE_WINDOW = 30;
const END_OF_DAY_HOUR = 17;
const DAY_MS = 86_400_000;

const CUE =
  /\b(?:by|before|until|till|due|deadline|no later than|not later than)\s*(?:on|by|is|of)?\s*(?:the\s+)?(?:end of\s+)?$/i;

export interface GroundedDeadline {
  /** ISO-8601 UTC, or null. */
  readonly value: string | null;
  readonly source: "text" | "model" | null;
  /** True when the model gave a date that was dropped as implausible or unreadable. */
  readonly droppedModelDate: boolean;
}

/** A date from one day before the message arrived to two years after. */
export function isPlausibleDate(date: Date, receivedAt: Date): boolean {
  const t = date.getTime();
  if (Number.isNaN(t)) return false;
  return t >= receivedAt.getTime() - DAY_MS && t <= receivedAt.getTime() + 2 * 365 * DAY_MS;
}

function fromText(text: string, receivedAt: Date): Date | null {
  const found: Date[] = [];
  for (const result of chrono.parse(text.slice(0, MAX_TEXT_CHARS), receivedAt, {
    forwardDate: true,
  })) {
    const before = text.slice(Math.max(0, result.index - CUE_WINDOW), result.index);
    const cued = CUE.test(before) || /^within\b/i.test(result.text);
    if (!cued) continue;

    const date = result.start.date();
    // A date with no time of day means the end of that working day.
    if (!result.start.isCertain("hour") && !/^within\b/i.test(result.text)) {
      date.setHours(END_OF_DAY_HOUR, 0, 0, 0);
    }
    if (isPlausibleDate(date, receivedAt) && date.getTime() >= receivedAt.getTime()) {
      found.push(date);
    }
  }
  found.sort((a, b) => a.getTime() - b.getTime());
  return found[0] ?? null;
}

export function groundDeadline(
  text: string,
  receivedAt: Date,
  modelValue: string | null,
): GroundedDeadline {
  const fromMessage = fromText(text, receivedAt);
  if (fromMessage)
    return { value: fromMessage.toISOString(), source: "text", droppedModelDate: false };

  if (modelValue === null) return { value: null, source: null, droppedModelDate: false };
  const model = new Date(modelValue);
  if (isPlausibleDate(model, receivedAt)) {
    return { value: modelValue, source: "model", droppedModelDate: false };
  }
  return { value: null, source: null, droppedModelDate: true };
}
