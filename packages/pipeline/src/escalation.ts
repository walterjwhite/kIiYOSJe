/**
 * Escalation deadline logic.
 *
 * Rules:
 *   1. If the classifier found an explicit deadline (escalateBy), use it.
 *   2. Otherwise derive from urgency relative to receivedAt:
 *        high   →  2 hours
 *        medium → 24 hours
 *        low    → 72 hours
 *        acknowledgement or information with low urgency → null (no deadline)
 *
 * The deadline is stored on both the signal and the thought.  The background
 * checker promotes overdue thoughts to `active` state so they appear at the
 * top of the brief.
 */

import type { ClassifierOutput } from "./classify.js";

const URGENCY_HOURS: Record<string, number> = {
  high: 2,
  medium: 24,
  low: 72,
};

/** Kinds that don't warrant a deadline unless the classifier found an explicit one. */
const NO_DEADLINE_KINDS = new Set(["acknowledgement", "information"]);

export function computeEscalateBy(
  classifierOut: ClassifierOutput,
  receivedAt: Date,
): string | null {
  // Explicit deadline from classifier wins.
  if (classifierOut.escalateBy) return classifierOut.escalateBy;

  // Acknowledgements and information with no urgency cue need no deadline.
  if (NO_DEADLINE_KINDS.has(classifierOut.signalKind) && classifierOut.urgency === "low") {
    return null;
  }

  const hours = URGENCY_HOURS[classifierOut.urgency] ?? 72;
  const deadline = new Date(receivedAt.getTime() + hours * 60 * 60 * 1000);
  return deadline.toISOString();
}
