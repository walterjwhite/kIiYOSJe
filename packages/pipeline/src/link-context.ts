/**
 * What the goal shortlist is built from, read from the local database: the
 * open goals (with their parent's title), the messages the operator linked to
 * a goal by hand, and the goals the same thread is already linked to.
 *
 * Only manual links count as examples. An automatic link is the model's own
 * guess, so learning from it would let a mistake reinforce itself.
 */

import type { Db } from "@mind/core";
import { events, signals, thoughts } from "@mind/core";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Exemplar, GoalDoc } from "./link-candidates.js";

/** How many recent manual links to look through. Bounds the work per signal. */
const RECENT_MANUAL_LINKS = 300;
const EXEMPLARS_PER_GOAL = 5;

export interface LinkContext {
  readonly goals: GoalDoc[];
  readonly exemplars: Exemplar[];
  readonly threadGoalIds: string[];
}

export function loadLinkContext(
  db: Db,
  signal: { readonly id: string; readonly threadId: string | null },
): LinkContext {
  const rows = db
    .select({
      id: thoughts.id,
      title: thoughts.title,
      body: thoughts.body,
      parentId: thoughts.parentId,
    })
    .from(thoughts)
    .where(eq(thoughts.state, "goal"))
    .all();

  // A parent that is itself no longer an open goal (closed or parked) still names the work.
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const missing = [
    ...new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p && !titles.has(p))),
  ];
  if (missing.length > 0) {
    for (const p of db
      .select({ id: thoughts.id, title: thoughts.title })
      .from(thoughts)
      .where(inArray(thoughts.id, missing))
      .all()) {
      titles.set(p.id, p.title);
    }
  }
  const goals: GoalDoc[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    parentTitle: r.parentId ? (titles.get(r.parentId) ?? null) : null,
  }));
  const goalIds = new Set(goals.map((g) => g.id));
  if (goals.length === 0) return { goals, exemplars: [], threadGoalIds: [] };

  // Manual links, newest first. The operator's own decision is the label.
  const links = db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.kind, "signal.thought_linked"), eq(events.actor, "user")))
    .orderBy(desc(events.at))
    .limit(RECENT_MANUAL_LINKS)
    .all()
    .flatMap((e) => {
      try {
        const p = JSON.parse(e.payload) as { signalId?: unknown; thoughtId?: unknown };
        return typeof p.signalId === "string" && typeof p.thoughtId === "string"
          ? [{ signalId: p.signalId, thoughtId: p.thoughtId }]
          : [];
      } catch {
        return [];
      }
    })
    .filter((l) => goalIds.has(l.thoughtId) && l.signalId !== signal.id);

  const exemplars: Exemplar[] = [];
  if (links.length > 0) {
    // Keep a link only while the signal is still linked there: an unlink or a move cancels it.
    const stored = new Map(
      db
        .select({
          id: signals.id,
          sender: signals.sender,
          subject: signals.subject,
          thoughtId: signals.thoughtId,
        })
        .from(signals)
        .where(
          inArray(
            signals.id,
            links.map((l) => l.signalId),
          ),
        )
        .all()
        .map((s) => [s.id, s]),
    );
    const perGoal = new Map<string, number>();
    const seen = new Set<string>();
    for (const l of links) {
      const s = stored.get(l.signalId);
      if (!s || s.thoughtId !== l.thoughtId || seen.has(l.signalId)) continue;
      seen.add(l.signalId);
      const n = perGoal.get(l.thoughtId) ?? 0;
      if (n >= EXEMPLARS_PER_GOAL) continue;
      perGoal.set(l.thoughtId, n + 1);
      exemplars.push({ goalId: l.thoughtId, sender: s.sender, subject: s.subject });
    }
  }

  const threadGoalIds = signal.threadId
    ? [
        ...new Set(
          db
            .select({ thoughtId: signals.thoughtId })
            .from(signals)
            .where(
              and(
                eq(signals.threadId, signal.threadId),
                ne(signals.id, signal.id),
                sql`${signals.thoughtId} is not null`,
              ),
            )
            .all()
            .map((s) => s.thoughtId)
            .filter((t): t is string => t !== null && goalIds.has(t)),
        ),
      ]
    : [];

  return { goals, exemplars, threadGoalIds };
}
