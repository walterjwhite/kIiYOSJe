/**
 * Step 3 — Match.
 * Finds the highest-specificity Direction for a signal.
 * Specificity order: person > thread > project > topic > catch-all.
 *
 * The catch-all (system/catch-all) is treated as specificity 0 and only wins
 * when no other direction matches, giving explicit directions full priority.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@mind/core";
import { directions } from "@mind/core";
import type { NewSignal } from "@mind/core";
import { FALLBACK_DIRECTION_ID } from "./fallback-direction.js";

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
  isFallback: boolean;
}

export function matchSignal(db: Db, signal: NewSignal): MatchResult | null {
  const enabled = db.select().from(directions).where(eq(directions.enabled, true)).all();

  let best: MatchResult | null = null;

  for (const dir of enabled) {
    // The catch-all only matches if nothing else does.
    if (dir.id === FALLBACK_DIRECTION_ID) continue;

    if (!matchesScope(dir, signal) && !matchesPrompt(dir, signal)) continue;
    const specificity = SPECIFICITY[dir.scopeKind] ?? 0;
    if (best === null || specificity > best.specificity) {
      best = { direction: dir, specificity, isFallback: false };
    }
  }

  // No explicit match — try the catch-all.
  if (!best) {
    const fallback = enabled.find((d) => d.id === FALLBACK_DIRECTION_ID);
    if (fallback) {
      best = { direction: fallback, specificity: 0, isFallback: true };
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
      return signal.body.toLowerCase().includes(v) || signal.sender.toLowerCase().includes(v);
    case "topic":
      // Empty scopeValue is reserved for the catch-all; skip here.
      if (!v) return false;
      return signal.body.toLowerCase().includes(v);
    default:
      return false;
  }
}

/**
 * STATUS.md gap #12: `scope.value` substring matching misses real phrasing
 * that doesn't contain the exact keyword verbatim. `matchPrompt` gives a
 * direction's author a place to list the phrases/synonyms that should also
 * count as a match, without requiring an LLM call in this synchronous step.
 * Treated as a plain list of phrases, one per line or comma-separated;
 * any phrase found in the signal body is enough.
 */
function matchesPrompt(dir: DirectionRow, signal: NewSignal): boolean {
  if (!dir.matchPrompt) return false;
  const body = signal.body.toLowerCase();
  const phrases = dir.matchPrompt
    .split(/[\n,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  return phrases.some((p) => body.includes(p));
}
