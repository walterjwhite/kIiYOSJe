import { Hono } from "hono";
import { desc, eq, gte, sql } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import {
  directions,
  events,
  signals,
  actions,
  newId,
  UpdateDirectionRequestSchema,
  PreviewDirectionRequestSchema,
} from "@mind/core";
import type { Db, NewSignal } from "@mind/core";
import { classify, evaluateGuards, matchSignal } from "@mind/pipeline";

export function directionsRouter(db: Db) {
  const app = new Hono();

  // GET /directions — all directions with signal/action counts
  app.get("/", (c) => {
    const rows = db.select().from(directions).all();

    const enriched = rows.map((dir) => {
      const totalSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(eq(signals.directionId, dir.id))
          .get()?.count ?? 0;

      const absorbedSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(
            sql`${signals.directionId} = ${dir.id} and ${signals.disposition} = 'absorbed'`,
          )
          .get()?.count ?? 0;

      // Actions linked via signalId → signals → directionId
      const proposedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} = 'proposed'`,
          )
          .get()?.count ?? 0;

      const discardedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} = 'discarded'`,
          )
          .get()?.count ?? 0;

      const totalDecidedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} in ('proposed','sent','discarded')`,
          )
          .get()?.count ?? 0;

      return {
        ...dir,
        signals: totalSignals,
        absorbed: absorbedSignals,
        proposed: proposedActions,
        discarded: discardedActions,
        overrideRate:
          totalDecidedActions > 0
            ? +(discardedActions / totalDecidedActions).toFixed(4)
            : null,
      };
    });

    return c.json(enriched);
  });

  // PUT /directions/:id — update guarded fields, plus name/standard/prompts
  app.put(
    "/:id",
    zValidator("json", UpdateDirectionRequestSchema),
    (c) => {
      const { id } = c.req.param();
      const body = c.req.valid("json");
      const now = new Date().toISOString();

      const existing = db
        .select()
        .from(directions)
        .where(eq(directions.id, id))
        .get();

      if (!existing) return c.json({ error: "Not found" }, 404);

      db.update(directions)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.posture !== undefined ? { posture: body.posture } : {}),
          ...(body.autonomy !== undefined ? { autonomy: body.autonomy } : {}),
          ...(body.confidenceMin !== undefined
            ? { confidenceMin: body.confidenceMin }
            : {}),
          ...(body.standard !== undefined ? { standard: body.standard } : {}),
          ...(body.matchPrompt !== undefined
            ? { matchPrompt: body.matchPrompt }
            : {}),
          ...(body.responsePrompt !== undefined
            ? { responsePrompt: body.responsePrompt }
            : {}),
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(eq(directions.id, id))
        .run();

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "direction.updated",
          payload: JSON.stringify({ directionId: id, changes: body }),
        })
        .run();

      return c.json({ ok: true });
    },
  );

  /**
   * POST /directions/preview — dry run. Answers the author's real question
   * ("what would this Direction have caught?") without writing anything to
   * signals, thoughts, or actions. Borrowed from Inbox Zero's rule Test tab and
   * MailTriage's per-rule dry run; see references.md §2.1.
   *
   * The Direction id arrives in the body: ids contain slashes
   * (`work/boss`, `system/catch-all`), so they cannot be a path segment.
   */
  app.post(
    "/preview",
    zValidator("json", PreviewDirectionRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const id = body.directionId;

      const dir = db
        .select()
        .from(directions)
        .where(eq(directions.id, id))
        .get();
      if (!dir) return c.json({ error: "Not found" }, 404);

      const limit = body.limit ?? 50;
      const since =
        body.since ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

      const rows = db
        .select()
        .from(signals)
        .where(gte(signals.receivedAt, since))
        .orderBy(desc(signals.receivedAt))
        .limit(limit)
        .all();

      const evaluated = rows.map((row) => {
        const candidate = toNewSignal(row);
        const match = matchSignal(db, candidate);
        return {
          row,
          candidate,
          matchedDirectionId: match?.direction.id ?? null,
          matchedByFallback: match?.isFallback ?? false,
          wouldMatch: match?.direction.id === dir.id,
          guardTriggered: evaluateGuards(dir, candidate, db).triggered,
        };
      });

      const wouldMatch = evaluated.filter((e) => e.wouldMatch);

      // Optionally ask the real classifier what it would make of the matches.
      // Capped hard: this is a model call per sample, not a free query.
      const classification: Array<{
        signalId: string;
        confidence: number;
        signalKind: string;
        answerable: boolean;
        answerBlocker: string | null;
        wouldEscalate: boolean;
        wouldDispute: boolean;
      }> = [];
      if (body.classify) {
        for (const sample of wouldMatch.slice(0, 10)) {
          const output = await classify({
            signalBody: sample.row.body,
            sender: sample.row.sender,
            standard: dir.standard,
            receivedAt: new Date(sample.row.receivedAt),
            matchPrompt: dir.matchPrompt,
          });
          classification.push({
            signalId: sample.row.id,
            confidence: output.confidence,
            signalKind: output.signalKind,
            answerable: output.answerable,
            answerBlocker: output.answerBlocker,
            wouldEscalate: output.confidence < dir.confidenceMin,
            wouldDispute:
              (output.signalKind === "question" || output.signalKind === "task") &&
              !output.answerable &&
              output.answerBlocker !== null,
          });
        }
      }

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "direction.previewed",
          payload: JSON.stringify({
            directionId: id,
            sampled: evaluated.length,
            wouldMatch: wouldMatch.length,
            guardsTriggered: wouldMatch.filter((e) => e.guardTriggered).length,
            classified: classification.length,
          }),
        })
        .run();

      return c.json({
        directionId: id,
        name: dir.name,
        sampleWindow: { since, limit },
        sampled: evaluated.length,
        wouldMatch: wouldMatch.length,
        matchedByFallback: evaluated.filter((e) => e.matchedByFallback).length,
        guardsTriggered: wouldMatch.filter((e) => e.guardTriggered).length,
        classification,
        samples: evaluated.map((e) => ({
          signalId: e.row.id,
          receivedAt: e.row.receivedAt,
          adapter: e.row.adapter,
          sender: e.row.sender,
          kind: e.row.kind,
          disposition: e.row.disposition,
          matchedDirectionId: e.matchedDirectionId,
          matchedByFallback: e.matchedByFallback,
          wouldMatch: e.wouldMatch,
          guardTriggered: e.guardTriggered,
        })),
      });
    },
  );

  return app;
}

/** Stored signal → the shape the matcher and guards expect. */
function toNewSignal(row: typeof signals.$inferSelect): NewSignal {
  let recipients: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.recipients);
    if (Array.isArray(parsed)) {
      recipients = parsed.filter((r): r is string => typeof r === "string");
    }
  } catch {
    // A malformed recipients blob is not worth failing a preview over.
  }

  return {
    adapter: row.adapter,
    externalId: row.externalId,
    threadId: row.threadId,
    sender: row.sender,
    recipients,
    kind: row.kind,
    body: row.body,
    receivedAt: new Date(row.receivedAt),
    urgencyHint: row.urgencyHint,
  };
}
