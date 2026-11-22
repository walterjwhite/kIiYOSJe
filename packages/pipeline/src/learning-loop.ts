/**
 * Learning loop — P5.
 *
 * Runs nightly (see learning-cycle.ts). Analyses the last 7 days of override
 * data and produces DirectionProposal records stored in the events table
 * (kind='direction.proposal'). They are never applied automatically; the
 * operator accepts or rejects via the extension or the API.
 *
 * Because every run looks at the same 7-day window, a proposal is only stored
 * when it is not already pending and was not accepted or rejected recently
 * (REPROPOSE_AFTER_DAYS). Spec: learning-loop-metrics, requirement 4.4.
 *
 * Three proposal kinds:
 *   narrow   — direction was overridden >20 % → raise confidenceMin
 *   widen    — direction was approved repeatedly (sent ≥ 3, override rate < 10 %) → lower confidenceMin or promote autonomy
 *   new      — ≥ 3 unmatched signals share a sender or topic pattern → propose a new direction
 */

import type { Db } from "@mind/core";
import { actions, directions, events, logger, newId, signals } from "@mind/core";
import { eq, inArray, sql } from "drizzle-orm";

export interface DirectionProposal {
  kind: "narrow" | "widen" | "new";
  directionId: string | null; // null for 'new' proposals
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  evidence: {
    total: number;
    discarded: number;
    sent: number;
    overrideRate: number;
  };
}

const WINDOW_DAYS = 7;
const MIN_SAMPLE = 3;
const NARROW_THRESHOLD = 0.2; // override rate above this → narrow
const WIDEN_THRESHOLD = 0.1; // override rate below this AND sent >= MIN_SAMPLE → widen
const NEW_DIR_SIGNALS = 3; // unmatched signals from same sender → propose new direction
/** A proposal the operator accepted or rejected is not proposed again for this long. */
export const REPROPOSE_AFTER_DAYS = 30;

export interface LearningLoopOptions {
  /** Days a resolved (accepted or rejected) proposal suppresses an identical one. */
  reproposeAfterDays?: number;
  /** Injected clock for tests. */
  now?: Date;
}

/** Identity of a proposal: the same change to the same Direction. */
export function proposalKey(p: DirectionProposal): string {
  return [p.kind, p.directionId ?? "", p.field, JSON.stringify(p.proposedValue)].join("|");
}

/**
 * Keys that must not be proposed again: anything still pending, plus anything
 * resolved within the cooldown.
 */
function suppressedKeys(db: Db, now: Date, reproposeAfterDays: number): Set<string> {
  const cutoff = new Date(now.getTime() - reproposeAfterDays * 86_400_000).toISOString();
  const rows = db
    .select({ id: events.id, at: events.at, kind: events.kind, payload: events.payload })
    .from(events)
    .where(inArray(events.kind, ["direction.proposal", "direction.proposal.resolved"]))
    .all();

  const resolvedAt = new Map<string, string>();
  for (const e of rows) {
    if (e.kind !== "direction.proposal.resolved") continue;
    try {
      const id = (JSON.parse(e.payload) as { proposalEventId?: unknown }).proposalEventId;
      if (typeof id === "string") resolvedAt.set(id, e.at);
    } catch {
      /* an unreadable resolution suppresses nothing */
    }
  }

  const keys = new Set<string>();
  for (const e of rows) {
    if (e.kind !== "direction.proposal") continue;
    const resolved = resolvedAt.get(e.id);
    if (resolved !== undefined && resolved < cutoff) continue;
    try {
      keys.add(proposalKey(JSON.parse(e.payload) as DirectionProposal));
    } catch {
      /* skip */
    }
  }
  return keys;
}

export function runLearningLoop(db: Db, options: LearningLoopOptions = {}): DirectionProposal[] {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const proposals: DirectionProposal[] = [];

  // ── Narrow / widen existing directions ───────────────────────────────────
  const dirs = db.select().from(directions).all();

  for (const dir of dirs) {
    if (dir.id === "system/catch-all") continue; // never tune the fallback this way

    const stats = directionStats(db, dir.id, since);
    if (stats.total < MIN_SAMPLE) continue;

    if (stats.overrideRate > NARROW_THRESHOLD) {
      // Raise confidenceMin by 0.05, capped at 0.95
      const current = dir.confidenceMin;
      const proposed = Math.min(0.95, Math.round((current + 0.05) * 100) / 100);
      if (proposed !== current) {
        proposals.push({
          kind: "narrow",
          directionId: dir.id,
          field: "confidenceMin",
          currentValue: current,
          proposedValue: proposed,
          rationale: `Override rate ${(stats.overrideRate * 100).toFixed(0)}% over ${stats.total} actions exceeds ${(NARROW_THRESHOLD * 100).toFixed(0)}% threshold.`,
          evidence: stats,
        });
      }
    } else if (stats.overrideRate < WIDEN_THRESHOLD && stats.sent >= MIN_SAMPLE) {
      // Direction performing well — consider widening autonomy
      if (dir.autonomy === "observe") {
        proposals.push({
          kind: "widen",
          directionId: dir.id,
          field: "autonomy",
          currentValue: "observe",
          proposedValue: "draft",
          rationale: `Override rate ${(stats.overrideRate * 100).toFixed(0)}% and ${stats.sent} approved sends in window suggest safe to draft.`,
          evidence: stats,
        });
      } else if (dir.autonomy === "draft") {
        proposals.push({
          kind: "widen",
          directionId: dir.id,
          field: "autonomy",
          currentValue: "draft",
          proposedValue: "send",
          rationale: `Override rate ${(stats.overrideRate * 100).toFixed(0)}% and ${stats.sent} approved sends in window suggest safe to send autonomously.`,
          evidence: stats,
        });
      } else if (dir.confidenceMin > 0.6) {
        // Already at send autonomy — lower the confidence bar slightly
        const current = dir.confidenceMin;
        const proposed = Math.max(0.6, Math.round((current - 0.05) * 100) / 100);
        if (proposed !== current) {
          proposals.push({
            kind: "widen",
            directionId: dir.id,
            field: "confidenceMin",
            currentValue: current,
            proposedValue: proposed,
            rationale: `Consistent approval with override rate ${(stats.overrideRate * 100).toFixed(0)}% suggests lowering confidence threshold is safe.`,
            evidence: stats,
          });
        }
      }
    }
  }

  // ── Propose new directions from unmatched signal clusters ────────────────
  const unmatchedProposals = proposeFromUnmatched(db, since);
  proposals.push(...unmatchedProposals);

  // Drop what is already pending or was resolved recently, and repeats within this run.
  const seen = suppressedKeys(db, now, options.reproposeAfterDays ?? REPROPOSE_AFTER_DAYS);
  const fresh: DirectionProposal[] = [];
  for (const p of proposals) {
    const key = proposalKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(p);
  }

  // Persist each proposal as an event so the operator can review them.
  for (const p of fresh) {
    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: "direction.proposal",
        payload: JSON.stringify(p),
      })
      .run();
  }

  logger.info(
    { count: fresh.length, suppressed: proposals.length - fresh.length },
    "learning loop: proposals generated",
  );
  return fresh;
}

function directionStats(
  db: Db,
  directionId: string,
  since: string,
): { total: number; discarded: number; sent: number; overrideRate: number } {
  const rows = db
    .select({ status: actions.status })
    .from(actions)
    .innerJoin(signals, eq(actions.signalId, signals.id))
    .where(
      sql`${signals.directionId} = ${directionId}
          and ${actions.createdAt} >= ${since}
          and ${actions.status} in ('proposed','sent','discarded')`,
    )
    .all();

  const total = rows.length;
  const discarded = rows.filter((r) => r.status === "discarded").length;
  const sent = rows.filter((r) => r.status === "sent").length;
  return {
    total,
    discarded,
    sent,
    overrideRate: total > 0 ? discarded / total : 0,
  };
}

function proposeFromUnmatched(db: Db, since: string): DirectionProposal[] {
  // Find signals where directionId IS NULL or directionId = catch-all
  // that accumulated ≥ NEW_DIR_SIGNALS from the same sender.
  const rows = db
    .select({
      sender: signals.sender,
      count: sql<number>`count(*) as count`,
    })
    .from(signals)
    .where(
      sql`(${signals.directionId} is null or ${signals.directionId} = 'system/catch-all')
          and ${signals.receivedAt} >= ${since}`,
    )
    .groupBy(signals.sender)
    .having(sql`count(*) >= ${NEW_DIR_SIGNALS}`)
    .all();

  return rows.map((row) => ({
    kind: "new" as const,
    directionId: null,
    field: "scope.value",
    currentValue: null,
    proposedValue: row.sender,
    rationale: `${row.count} unmatched signals from ${row.sender} in the last ${WINDOW_DAYS} days. Consider adding a person-scoped direction.`,
    evidence: { total: row.count, discarded: 0, sent: 0, overrideRate: 0 },
  }));
}
