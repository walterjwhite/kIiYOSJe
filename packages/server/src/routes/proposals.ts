/**
 * Direction proposals produced by the learning loop (PLAN §12).
 * Proposals live in the events table (kind='direction.proposal').
 * Resolution is recorded as a later event (kind='direction.proposal.resolved'),
 * so the audit log stays append-only.
 *
 * Accepting a proposal updates the database row only. The YAML file under
 * directions/ is the source of truth and is NOT rewritten; the response
 * returns the YAML change the operator must make, otherwise the next
 * SIGHUP reload would silently revert the accepted change.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { directions, events, learningSettings, newId } from "@mind/core";
import type { Db } from "@mind/core";
import { isLearningRunning, lastLearningRun, runLearningCycle } from "@mind/pipeline";
import type { DirectionProposal } from "@mind/pipeline";

interface StoredProposal {
  eventId: string;
  at: string;
  proposal: DirectionProposal;
  status: "pending" | "accepted" | "rejected";
  yamlChange?: string | null;
}

const APPLICABLE_FIELDS = new Set(["confidenceMin", "autonomy"]);

/** The hand edit that makes an accepted proposal permanent. Null when nothing is applicable. */
function yamlChangeFor(p: DirectionProposal): string | null {
  if (p.kind !== "new" && p.directionId && APPLICABLE_FIELDS.has(p.field)) {
    return `In directions/${p.directionId}.yaml set ${p.field}: ${JSON.stringify(p.proposedValue)}`;
  }
  if (p.kind === "new") {
    return `Create a new direction file with scope: { kind: person, value: "${String(p.proposedValue)}" }`;
  }
  return null;
}

function loadProposals(db: Db): StoredProposal[] {
  const all = db.select().from(events).all();
  const resolved = new Map<string, "accepted" | "rejected">();
  for (const e of all) {
    if (e.kind !== "direction.proposal.resolved") continue;
    const p = JSON.parse(e.payload) as {
      proposalEventId: string;
      resolution: "accepted" | "rejected";
    };
    resolved.set(p.proposalEventId, p.resolution);
  }
  return all
    .filter((e) => e.kind === "direction.proposal")
    .map((e): StoredProposal => {
      const proposal = JSON.parse(e.payload) as DirectionProposal;
      const status = resolved.get(e.id) ?? "pending";
      return {
        eventId: e.id,
        at: e.at,
        proposal,
        status,
        yamlChange: status === "accepted" ? yamlChangeFor(proposal) : null,
      };
    });
}

export function proposalsRouter(db: Db) {
  const app = new Hono();

  // GET /proposals?status=pending&days=30
  app.get("/", (c) => {
    const status = c.req.query("status");
    const days = Number(c.req.query("days") ?? 30);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = loadProposals(db).filter((row) => row.at >= since);
    return c.json(status ? rows.filter((r) => r.status === status) : rows);
  });

  // GET /proposals/insights?limit=10 — the AI-generated narratives
  // (learning.insight events) attached to past runs, newest first.
  app.get("/insights", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 10) || 10, 50);
    const rows = db
      .select()
      .from(events)
      .where(eq(events.kind, "learning.insight"))
      .all()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit)
      .map((e) => JSON.parse(e.payload) as { at: string; insight: string; proposalCount: number });
    return c.json(rows);
  });

  // GET /proposals/schedule — when the loop runs on its own and when it last did.
  app.get("/schedule", (c) => {
    return c.json({
      window: learningSettings(),
      lastRun: lastLearningRun(db),
      lastScheduledRun: lastLearningRun(db, "schedule"),
      running: isLearningRunning(),
    });
  });

  // POST /proposals/run — generate proposals now instead of waiting for the
  // nightly window. Same function the scheduler uses (learning-cycle.ts): the
  // rule-based loop decides every proposed value; the model only adds a
  // plain-language insight, skipped quietly if no provider is configured.
  app.post("/run", async (c) => {
    if (isLearningRunning()) return c.json({ error: "The learning loop is already running" }, 409);
    const { proposals, insight } = await runLearningCycle(db, "manual");
    return c.json({ proposals, insight });
  });

  // POST /proposals/:id/accept
  app.post("/:id/accept", (c) => {
    const { id } = c.req.param();
    const stored = loadProposals(db).find((p) => p.eventId === id);
    if (!stored) return c.json({ error: "Not found" }, 404);
    if (stored.status !== "pending") return c.json({ error: `Already ${stored.status}` }, 409);

    const p = stored.proposal;
    const yamlChange = yamlChangeFor(p);

    if (p.kind !== "new" && p.directionId && APPLICABLE_FIELDS.has(p.field)) {
      db.update(directions)
        .set({ [p.field]: p.proposedValue, updatedAt: new Date().toISOString() })
        .where(eq(directions.id, p.directionId))
        .run();
    }

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "direction.proposal.resolved",
        payload: JSON.stringify({ proposalEventId: id, resolution: "accepted" }),
      })
      .run();

    return c.json({ ok: true, yamlChange });
  });

  // POST /proposals/:id/reject
  app.post("/:id/reject", (c) => {
    const { id } = c.req.param();
    const stored = loadProposals(db).find((p) => p.eventId === id);
    if (!stored) return c.json({ error: "Not found" }, 404);
    if (stored.status !== "pending") return c.json({ error: `Already ${stored.status}` }, 409);

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "direction.proposal.resolved",
        payload: JSON.stringify({ proposalEventId: id, resolution: "rejected" }),
      })
      .run();

    return c.json({ ok: true });
  });

  return app;
}
