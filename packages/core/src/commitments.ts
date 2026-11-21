/**
 * Commitments — a promise made in a thread, as a state machine.
 *
 * The failure this prevents: "I'll have it Friday" followed by "pushing it to
 * Wednesday" must not leave two live reminders. States are *replaced*; the
 * history is *appended*. `previousStates` is the audit trail, `status` is the
 * current truth, and `supersededBy` names the signal that replaced it.
 *
 * The model is borrowed from OpenLoomi's commitment lifecycle (see
 * references.md §2.4); the implementation is this repo's own, and it is
 * deliberately a JSON column on `thoughts` rather than a sixth table — one
 * commitment per Thought, replaced in place.
 */

import { z } from "zod";

export const COMMITMENT_STATUSES = [
  "proposed", // found in a signal, not yet acted on
  "accepted", // the operator confirmed it
  "changed", // superseded by a later message; see previousStates
  "done",
  "dropped",
  "disputed", // conflicting evidence, needs the operator to settle it
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const CommitmentStateChangeSchema = z.object({
  status: z.enum(COMMITMENT_STATUSES),
  at: z.string(),
  text: z.string(),
  dueDate: z.string().nullable(),
  by: z.enum(["classifier", "operator"]),
});

export const CommitmentSchema = z.object({
  text: z.string(),
  /** ISO-8601. The promise date, not the reply deadline. */
  dueDate: z.string().nullable(),
  status: z.enum(COMMITMENT_STATUSES),
  /** Classifier confidence at the moment this was recorded. */
  confidence: z.number(),
  /** The signal that stated it, so every state is reconstructible. */
  sourceSignalId: z.string().nullable(),
  /** Last time a later message confirmed this commitment still stands. */
  lastVerifiedAt: z.string(),
  /** The signal that replaced this one, when status = changed. */
  supersededBy: z.string().nullable(),
  previousStates: z.array(CommitmentStateChangeSchema),
});

export type Commitment = z.infer<typeof CommitmentSchema>;
export type CommitmentStateChange = z.infer<typeof CommitmentStateChangeSchema>;

export interface NewCommitmentInput {
  text: string;
  dueDate: string | null;
  confidence: number;
  sourceSignalId: string | null;
  at: string;
}

export function newCommitment(input: NewCommitmentInput): Commitment {
  return {
    text: input.text.trim(),
    dueDate: input.dueDate,
    status: "proposed",
    confidence: input.confidence,
    sourceSignalId: input.sourceSignalId,
    lastVerifiedAt: input.at,
    supersededBy: null,
    previousStates: [],
  };
}

/** A later message confirms the same promise with the same date. */
export function verifyCommitment(commitment: Commitment, at: string): Commitment {
  return { ...commitment, lastVerifiedAt: at };
}

/**
 * A later message restates the promise differently — same thread, new content
 * or new date. The previous state is appended, never overwritten.
 */
export function supersedeCommitment(
  previous: Commitment,
  next: Commitment,
  at: string,
): Commitment {
  return {
    text: next.text,
    dueDate: next.dueDate,
    status: "changed",
    confidence: next.confidence,
    sourceSignalId: next.sourceSignalId,
    lastVerifiedAt: at,
    supersededBy: next.sourceSignalId,
    previousStates: [
      ...previous.previousStates,
      {
        status: previous.status,
        at: previous.lastVerifiedAt,
        text: previous.text,
        dueDate: previous.dueDate,
        by: "classifier",
      },
    ],
  };
}

/** Close it: `done` when it was delivered, `dropped` when it was abandoned. */
export function settleCommitment(
  commitment: Commitment,
  status: "done" | "dropped",
  at: string,
  by: "classifier" | "operator" = "operator",
): Commitment {
  return {
    ...commitment,
    status,
    lastVerifiedAt: at,
    previousStates: [
      ...commitment.previousStates,
      {
        status: commitment.status,
        at: at,
        text: commitment.text,
        dueDate: commitment.dueDate,
        by,
      },
    ],
  };
}

/** Conflicting evidence: say so instead of silently picking a side. */
export function disputeCommitment(commitment: Commitment, at: string): Commitment {
  if (commitment.status === "disputed") return commitment;
  return {
    ...commitment,
    status: "disputed",
    lastVerifiedAt: at,
    previousStates: [
      ...commitment.previousStates,
      {
        status: commitment.status,
        at,
        text: commitment.text,
        dueDate: commitment.dueDate,
        by: "classifier",
      },
    ],
  };
}

export function isOpenCommitment(commitment: Commitment): boolean {
  return (
    commitment.status === "proposed" ||
    commitment.status === "accepted" ||
    commitment.status === "changed"
  );
}

/**
 * Loose comparison for "is this the same promise". Case and punctuation are
 * ignored; wording differences are not, which is deliberate — a differently
 * worded promise is treated as a supersession so the history survives.
 */
export function sameCommitmentText(a: string, b: string): boolean {
  const norm = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

export function parseCommitment(raw: string | null | undefined): Commitment | null {
  if (!raw) return null;
  try {
    const parsed = CommitmentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeCommitment(commitment: Commitment): string {
  return JSON.stringify(commitment);
}
