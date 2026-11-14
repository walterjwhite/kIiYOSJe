/**
 * Learning loop — P5.
 *
 * Runs weekly. Analyses the last 7 days of override data and produces
 * DirectionProposal records stored in the events table (kind='direction.proposal').
 * They are never applied automatically; the operator accepts or rejects via
 * the extension or the API.
 *
 * Three proposal kinds:
 *   narrow   — direction was overridden >20 % → raise confidenceMin
 *   widen    — direction was approved repeatedly (sent ≥ 3, override rate < 10 %) → lower confidenceMin or promote autonomy
 *   new      — ≥ 3 unmatched signals share a sender or topic pattern → propose a new direction
 */

import { sql, eq } from "drizzle-orm";
import type { Db } from "@mind/core";
import { directions, signals, actions, events, logger, newId } from "@mind/core";

export interface DirectionProposal {
  kind: "narrow" | "widen" | "new";
  directionId: string | null;    // null for 'new' proposals
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
const NARROW_THRESHOLD = 0.20;   // override rate above this → narrow
const WIDEN_THRESHOLD  = 0.10;   // override rate below this AND sent >= MIN_SAMPLE → widen
const NEW_DIR_SIGNALS  = 3;       // unmatched signals from same sender → propose new direction

export function runLearningLoop(db: Db): DirectionProposal[] {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
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

  // Persist each proposal as an event so the operator can review them.
  for (const p of proposals) {
    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: "direction.proposal",
        payload: JSON.stringify(p),
      })
      .run();
  }

  logger.info({ count: proposals.length }, "learning loop: proposals generated");
  return proposals;
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

const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function startLearningLoop(
  db: Db,
  intervalMs = WEEKLY_INTERVAL_MS,
): NodeJS.Timeout {
  return setInterval(() => {
    try {
      runLearningLoop(db);
    } catch (err) {
      logger.error({ err }, "learning loop: error");
    }
  }, intervalMs);
}
