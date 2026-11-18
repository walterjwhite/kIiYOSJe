import { Hono } from "hono";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  thoughts,
  actions,
  directions,
  signals,
  parseCommitment,
} from "@mind/core";
import type { Db } from "@mind/core";

export function briefRouter(db: Db) {
  const app = new Hono();

  // GET /brief — today's summary payload.
  //
  // Two halves, deliberately: what needs me (the morning side) and what was
  // handled without me (the evening side). The second half is the receipt for
  // the coverage claim — "absorbed 11, 2 thoughts, 0 sends" — and without it
  // the ratio is only ever asserted, never shown.
  app.get("/", (c) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.toISOString();
    const now = new Date().toISOString();

    // Active thoughts: explicitly promoted by the escalation checker or by the user.
    const activeThoughts = db
      .select()
      .from(thoughts)
      .where(eq(thoughts.state, "active"))
      .all();

    // Confident but blocked: something needs my judgement, not a draft.
    const disputedThoughts = db
      .select()
      .from(thoughts)
      .where(eq(thoughts.state, "disputed"))
      .all();

    // New seedlings created today (not yet overdue).
    const newSeedlings = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.state} = 'seedling'
          and ${thoughts.createdAt} >= ${since}
          and (${thoughts.escalateBy} is null or ${thoughts.escalateBy} > ${now})
        `,
      )
      .all();

    // Overdue seedlings: escalateBy in the past but not yet promoted (checker
    // runs async; this catches the gap before the next tick).
    const overdueThoughts = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.state} = 'seedling'
          and ${thoughts.escalateBy} is not null
          and ${thoughts.escalateBy} <= ${now}
        `,
      )
      .all();

    // Thoughts with reviewAt due (any state except closed).
    const reviewDue = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.reviewAt} is not null
          and ${thoughts.reviewAt} <= ${now}
          and ${thoughts.state} != 'closed'
        `,
      )
      .all();

    const proposed = db
      .select()
      .from(actions)
      .where(eq(actions.status, "proposed"))
      .all();

    const absorbedToday = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`,
      )
      .get();

    const filedToday =
      db
        .select({ count: sql<number>`count(*)` })
        .from(signals)
        .where(
          sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'filed'`,
        )
        .get()?.count ?? 0;

    const sentToday =
      db
        .select({ count: sql<number>`count(*)` })
        .from(actions)
        .where(
          sql`${actions.sentAt} is not null and ${actions.sentAt} >= ${since} and ${actions.status} = 'sent'`,
        )
        .get()?.count ?? 0;

    const activeDirections = db
      .select({ id: directions.id, name: directions.name, posture: directions.posture })
      .from(directions)
      .where(eq(directions.enabled, true))
      .all();

    // Commitments still standing, with their supersession history attached.
    const commitments = db
      .select()
      .from(thoughts)
      .where(
        and(
          isNotNull(thoughts.commitment),
          sql`${thoughts.state} != 'closed'`,
        ),
      )
      .all()
      .map((thought) => ({
        thoughtId: thought.id,
        title: thought.title,
        state: thought.state,
        commitment: parseCommitment(thought.commitment),
      }))
      .filter((row) => row.commitment !== null);

    // Two-sided reply tracking: replies that went out and got no answer.
    const awaitingRows = db
      .select({
        signalId: signals.id,
        threadId: signals.threadId,
        adapter: signals.adapter,
        sender: signals.sender,
        thoughtId: signals.thoughtId,
        awaitingReplyAt: signals.awaitingReplyAt,
      })
      .from(signals)
      .where(
        and(
          isNotNull(signals.awaitingReplyAt),
          isNull(signals.replyReceivedAt),
        ),
      )
      .all();

    // One entry per thread, dated from the oldest unanswered wait.
    const byThread = new Map<string, (typeof awaitingRows)[number]>();
    for (const row of awaitingRows) {
      const key = row.threadId ?? row.signalId;
      const existing = byThread.get(key);
      if (
        !existing ||
        (existing.awaitingReplyAt ?? "") > (row.awaitingReplyAt ?? "")
      ) {
        byThread.set(key, row);
      }
    }
    const awaiting = [...byThread.values()]
      .map((row) => ({
        ...row,
        hoursWaiting: row.awaitingReplyAt
          ? +((Date.now() - Date.parse(row.awaitingReplyAt)) / 3_600_000).toFixed(1)
          : null,
      }))
      .sort((a, b) => (b.hoursWaiting ?? 0) - (a.hoursWaiting ?? 0))
      .slice(0, 50);

    return c.json({
      date: new Date().toISOString().slice(0, 10),
      thoughts: {
        active: activeThoughts,
        disputed: disputedThoughts,
        overdue: overdueThoughts,
        reviewDue,
        newToday: newSeedlings,
      },
      actions: { proposed },
      commitments,
      awaiting,
      absorb: { today: absorbedToday?.count ?? 0 },
      handled: {
        absorbed: absorbedToday?.count ?? 0,
        filed: filedToday,
        sent: sentToday,
        disputed: disputedThoughts.length,
        awaitingReply: awaiting.length,
      },
      directions: { active: activeDirections },
    });
  });

  return app;
}
