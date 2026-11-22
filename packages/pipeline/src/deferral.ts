/**
 * Holding a signal while the model is unavailable.
 *
 * A provider that is down or slow says nothing about the message, so the signal
 * is stored as it arrived (disposition `new`), a `signal.deferred` event records
 * why and when to try again, and `deferred-retry.ts` processes it later. It is
 * never absorbed, drafted, or sent in the meantime, and never dropped. After
 * MAX_DEFER_ATTEMPTS tries it is held for the operator with zero confidence.
 * The event carries a log-safe reason and a time, never message text.
 */

import type { Db, NewSignal } from "@mind/core";
import { events, newId, signals } from "@mind/core";
import type { IngestResult } from "./ingest.js";

/** Tries before a signal is handed to the operator instead of waiting longer. */
export const MAX_DEFER_ATTEMPTS = 8;

const FIRST_DELAY_MS = 60_000;
const MAX_DELAY_MS = 3_600_000;

/** Wait before try number `attempt + 1`: a minute, doubling, at most an hour. */
export function nextAttemptDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
  return Math.min(FIRST_DELAY_MS * 2 ** (n - 1), MAX_DELAY_MS);
}

export interface DeferInput {
  readonly signal: NewSignal;
  readonly normalizedBody: string;
  readonly dedupeKey: string;
  readonly directionId: string | null;
  /** Log-safe: a status, a network code, or a policy code. */
  readonly reason: string;
  /** Tries so far, counting the one that just failed. */
  readonly attempt: number;
  /** Set when a retry fails again: the row already exists. */
  readonly existingSignalId?: string;
  readonly now?: Date;
}

export function deferSignal(db: Db, input: DeferInput): IngestResult {
  const now = input.now ?? new Date();
  const { signal } = input;
  const signalId = input.existingSignalId ?? newId();

  if (!input.existingSignalId) {
    db.insert(signals)
      .values({
        id: signalId,
        adapter: signal.adapter,
        account: signal.account ?? null,
        externalId: signal.externalId,
        threadId: signal.threadId,
        sender: signal.sender,
        recipients: JSON.stringify(signal.recipients),
        cc: signal.cc && signal.cc.length > 0 ? JSON.stringify(signal.cc) : null,
        bcc: signal.bcc && signal.bcc.length > 0 ? JSON.stringify(signal.bcc) : null,
        kind: signal.kind,
        subject: signal.subject ?? null,
        body: input.normalizedBody,
        htmlBody: signal.htmlBody ?? null,
        receivedAt: signal.receivedAt.toISOString(),
        urgencyHint: signal.urgencyHint,
        disposition: "new",
        directionId: input.directionId,
        dedupeKey: input.dedupeKey,
      })
      .run();
  }

  const nextAttemptAt = new Date(now.getTime() + nextAttemptDelayMs(input.attempt)).toISOString();
  db.insert(events)
    .values({
      id: newId(),
      at: now.toISOString(),
      actor: "system",
      kind: "signal.deferred",
      payload: JSON.stringify({
        signalId,
        adapter: signal.adapter,
        attempt: input.attempt,
        reason: input.reason,
        nextAttemptAt,
      }),
    })
    .run();

  return {
    disposition: "new",
    signalId,
    thoughtId: null,
    actionId: null,
    reason: `model unavailable (${input.reason}), will retry`,
  };
}
