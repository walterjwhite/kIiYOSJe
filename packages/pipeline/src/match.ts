/**
 * Step 3 — Match.
 * Finds the highest-specificity Direction for a signal.
 * Specificity order: person > thread > project > topic.
 */

import { eq, and } from "drizzle-orm";
import type { Db } from "@mind/core";
import { directions } from "@mind/core";
import type { NewSignal } from "@mind/core";

type DirectionRow = typeof directions.$inferSelect;

const SPECIFICITY: Record<string, number> = {
  person: 4,
  thread: 3,
  project: 2,
  topic: 1,
};

export interface MatchResult {
  direction: DirectionRow;
  specificity: number;
}

export function matchSignal(db: Db, signal: NewSignal): MatchResult | null {
  const enabled = db
    .select()
    .from(directions)
    .where(eq(directions.enabled, true))
    .all();

  let best: MatchResult | null = null;

  for (const dir of enabled) {
    if (!matchesScope(dir, signal)) continue;
    const specificity = SPECIFICITY[dir.scopeKind] ?? 0;
    if (best === null || specificity > best.specificity) {
      best = { direction: dir, specificity };
    }
  }

  return best;
}

function matchesScope(dir: DirectionRow, signal: NewSignal): boolean {
  const v = dir.scopeValue.toLowerCase();
  switch (dir.scopeKind) {
    case "person":
      return (
        signal.sender.toLowerCase() === v ||
        signal.recipients.map((r) => r.toLowerCase()).includes(v)
      );
    case "thread":
      return signal.threadId?.toLowerCase() === v;
    case "project":
      // topic/project matching by keyword in body — simple for now
      return (
        signal.body.toLowerCase().includes(v) ||
        signal.sender.toLowerCase().includes(v)
      );
    case "topic":
      return signal.body.toLowerCase().includes(v);
    default:
      return false;
  }
}
