import { Hono } from "hono";
import { desc, eq, gte, sql } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import {
  directions,
  events,
  signals,
  thoughts,
  actions,
  newId,
  logger,
  DirectionConfigSchema,
  UpdateDirectionRequestSchema,
  PreviewDirectionRequestSchema,
} from "@mind/core";
import type { Db, NewSignal } from "@mind/core";
import {
  classify,
  createDirectionFile,
  evaluateGuards,
  isValidDirectionId,
  loadDirections,
  matchSignal,
  patchDirectionFile,
  retireDirectionFile,
} from "@mind/pipeline";
import { existsSync } from "node:fs";
import { z } from "zod";
import { directionsRoot } from "../directions-dir.js";

const CATCH_ALL_ID = "system/catch-all";

const CreateDirectionRequestSchema = z.object({
  id: z.string().min(1),
  config: z.unknown(),
});

export function directionsRouter(db: Db) {
  const app = new Hono();

  // GET /directions/source — where the YAML files live. The extension opens
  // this folder; it is not necessarily the folder VS Code has open.
  app.get("/source", (c) => {
    const dir = directionsRoot();
    return c.json({ dir, exists: existsSync(dir) });
  });

  // POST /directions/reload — re-read every YAML file (same as SIGHUP).
  app.post("/reload", (c) => {
    const dir = directionsRoot();
    if (!existsSync(dir)) return c.json({ error: "directions dir not found" }, 404);
    loadDirections(db, dir);
    return c.json({ ok: true });
  });

  // POST /directions — create directions/<id>.yaml and load it.
  app.post("/", zValidator("json", CreateDirectionRequestSchema), (c) => {
    const { id, config } = c.req.valid("json");
    if (!isValidDirectionId(id) || id === CATCH_ALL_ID) {
      return c.json({ error: "invalid direction id" }, 400);
    }
    const parsed = DirectionConfigSchema.safeParse(config);
    if (!parsed.success) {
      return c.json({ error: "invalid direction", issues: parsed.error.issues }, 400);
    }
    const dir = directionsRoot();
    try {
      createDirectionFile(dir, id, parsed.data);
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 409);
    }
    loadDirections(db, dir);
    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "direction.created",
        payload: JSON.stringify({ directionId: id }),
      })
      .run();
    return c.json({ ok: true, id }, 201);
  });

  // DELETE /directions/:id — remove the row and retire the YAML file
  // (renamed to .deleted, so it can be restored). Signals and thoughts that
  // referenced it keep existing with no direction.
  app.delete("/:id", (c) => {
    const { id } = c.req.param();
    if (id === CATCH_ALL_ID) {
      return c.json({ error: "the catch-all direction cannot be deleted; disable it instead" }, 400);
    }
    const existing = db.select().from(directions).where(eq(directions.id, id)).get();
    if (!existing) return c.json({ error: "Not found" }, 404);

    let fileRetired = false;
    try {
      fileRetired = retireDirectionFile(directionsRoot(), id);
    } catch (err) {
      logger.warn({ id, err: String(err) }, "direction: could not retire YAML file");
    }

    db.transaction((tx) => {
      tx.update(signals).set({ directionId: null }).where(eq(signals.directionId, id)).run();
      tx.update(thoughts).set({ directionId: null }).where(eq(thoughts.directionId, id)).run();
      tx.delete(directions).where(eq(directions.id, id)).run();
      tx.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "direction.deleted",
          payload: JSON.stringify({ directionId: id, fileRetired }),
        })
        .run();
    });
    return c.json({ ok: true, fileRetired });
  });

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
          ...(body.scopeKind !== undefined ? { scopeKind: body.scopeKind } : {}),
          ...(body.scopeValue !== undefined ? { scopeValue: body.scopeValue } : {}),
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
          ...(body.transformPrompt !== undefined
            ? { transformPrompt: body.transformPrompt }
            : {}),
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(eq(directions.id, id))
        .run();

      // Write the edit back to directions/<id>.yaml, or the next restart or
      // reload would overwrite it with the old file contents.
      let fileUpdated = false;
      try {
        fileUpdated = patchDirectionFile(directionsRoot(), id, body);
      } catch (err) {
        logger.warn({ id, err: String(err) }, "direction: could not update YAML file");
      }

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "direction.updated",
          payload: JSON.stringify({ directionId: id, changes: body }),
        })
        .run();

      return c.json({ ok: true, fileUpdated });
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
