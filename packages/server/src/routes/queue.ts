/**
 * /queue — what is awaiting the operator, in the operator's order.
 *
 * A Queue item is one of:
 *   reply      a proposed action (a drafted reply) awaiting approval
 *   attention  a promoted or escalated signal with no proposed reply that has
 *              not been acknowledged
 *
 * GET  /queue       items with their timing, per-item actions and saved order
 * PUT  /queue/order saves the drag-and-drop order of the item ids you can see
 * PUT  /queue/plan  plans items for a day, or returns them to the backlog
 * GET  /queue/:id   one item with its thread, thought, history and actions
 *
 * Item ids are "action:<id>" or "signal:<id>".
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  SignalActionSchema,
  actions,
  directions,
  events,
  parseCommitment,
  queueOrder,
  queuePlan,
  signals,
  thoughts,
} from "@mind/core";
import type { Db, SignalAction } from "@mind/core";
import { BUCKET_RANK, queueTiming } from "../queue-timing.js";
import type { QueueTiming } from "../queue-timing.js";

/** Attention signals older than this are left to Today/Signals, not the Queue. */
const ATTENTION_WINDOW_DAYS = 14;
const MAX_ITEMS = 200;

export interface ItemAction {
  id: string;
  label: string;
  kind: "approve" | "discard" | "acknowledge" | "openLink";
  linkPrefix?: string;
  confirm?: string;
  /** Cheap server-side hint that the message contains the link; the extension re-validates strictly before opening. */
  linkAvailable?: boolean;
}

interface Assessment {
  intent: string | null;
  urgency: string | null;
  signalKind: string | null;
  answerable: boolean | null;
  confidence: number | null;
  reason: string | null;
}

export interface QueueItem {
  id: string;
  type: "reply" | "attention";
  actionId: string | null;
  signalId: string;
  thoughtId: string | null;
  /** The Goal this item is linked to: its thought, when that thought is in the goal state. */
  goalId: string | null;
  adapter: string;
  account: string | null;
  sender: string;
  subject: string | null;
  summary: string;
  draftPreview: string | null;
  receivedAt: string;
  queuedAt: string;
  direction: { id: string; name: string } | null;
  assessment: Assessment | null;
  timing: QueueTiming;
  actions: ItemAction[];
  position: number | null;
  /** Day the operator plans to deal with it (YYYY-MM-DD, their timezone); null means backlog. */
  plannedFor: string | null;
}

const ItemIdSchema = z.string().regex(/^(action|signal):[\w-]+$/);

const OrderSchema = z.object({
  ids: z.array(ItemIdSchema).max(1000),
});

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

const PlanSchema = z.object({
  ids: z.array(ItemIdSchema).min(1).max(500),
  /** A calendar date, or null to return the items to the backlog. */
  date: z.string().refine(isCalendarDate, "expected a real date, YYYY-MM-DD").nullable(),
});

function parseSignalActions(json: string | null): SignalAction[] {
  if (!json) return [];
  try {
    const parsed = z.array(SignalActionSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function draftBody(payload: string): string {
  try {
    return (JSON.parse(payload) as { body?: string }).body ?? "";
  } catch {
    return "";
  }
}

/** The classifier's judgement for a signal, from its signal.processed event. */
function assessmentFor(db: Db, signalId: string): Assessment | null {
  const row = db
    .select({ payload: events.payload })
    .from(events)
    .where(
      sql`${events.kind} = 'signal.processed' and json_extract(${events.payload}, '$.signalId') = ${signalId}`,
    )
    .orderBy(desc(events.at))
    .limit(1)
    .get();
  if (!row) return null;
  try {
    const p = JSON.parse(row.payload) as Record<string, unknown>;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
    return {
      intent: str("intent"),
      urgency: str("urgency"),
      signalKind: str("signalKind"),
      answerable: typeof p["answerable"] === "boolean" ? (p["answerable"] as boolean) : null,
      confidence: typeof p["confidence"] === "number" ? (p["confidence"] as number) : null,
      reason: str("reason"),
    };
  } catch {
    return null;
  }
}

type SignalRow = typeof signals.$inferSelect;
type ActionRow = typeof actions.$inferSelect;

function buildItem(db: Db, signal: SignalRow, action: ActionRow | null, now: Date): QueueItem {
  const direction = signal.directionId
    ? (db.select().from(directions).where(eq(directions.id, signal.directionId)).get() ?? null)
    : null;
  const assessment = assessmentFor(db, signal.id);
  const type = action ? "reply" : "attention";
  const declared = parseSignalActions(direction?.signalActions ?? null);

  // A direction that declares its own buttons owns the item's actions.
  // Otherwise a reply gets approve/discard and anything else gets acknowledge.
  let itemActions: ItemAction[];
  if (declared.length > 0) {
    const haystack = `${signal.htmlBody ?? ""}\n${signal.body}`;
    itemActions = declared.map((a) =>
      a.kind === "acknowledge"
        ? { id: a.id, label: a.label, kind: "acknowledge" as const }
        : {
            id: a.id,
            label: a.label,
            kind: "openLink" as const,
            linkPrefix: a.linkPrefix,
            ...(a.confirm ? { confirm: a.confirm } : {}),
            linkAvailable: haystack.includes(a.linkPrefix),
          },
    );
  } else if (action) {
    itemActions = [
      { id: "approve", label: "Approve & send", kind: "approve" },
      { id: "discard", label: "Discard", kind: "discard" },
    ];
  } else {
    itemActions = [{ id: "acknowledge", label: "Acknowledge", kind: "acknowledge" }];
  }

  const body = action ? draftBody(action.payload) : "";
  const linkedThought = signal.thoughtId
    ? db
        .select({ state: thoughts.state })
        .from(thoughts)
        .where(eq(thoughts.id, signal.thoughtId))
        .get()
    : undefined;
  return {
    id: action ? `action:${action.id}` : `signal:${signal.id}`,
    type,
    actionId: action?.id ?? null,
    signalId: signal.id,
    thoughtId: signal.thoughtId,
    goalId: linkedThought?.state === "goal" ? signal.thoughtId : null,
    adapter: signal.adapter,
    account: signal.account,
    sender: signal.sender,
    subject: signal.subject,
    summary: signal.transformedSummary ?? signal.subject ?? oneLine(signal.body, 140),
    draftPreview: body ? oneLine(body, 200) : null,
    receivedAt: signal.receivedAt,
    queuedAt: action?.createdAt ?? signal.receivedAt,
    direction: direction ? { id: direction.id, name: direction.name } : null,
    assessment,
    timing: queueTiming(
      {
        type,
        signalKind: assessment?.signalKind ?? signal.signalKind,
        urgency: assessment?.urgency ?? null,
        escalateBy: signal.escalateBy,
      },
      now,
    ),
    actions: itemActions,
    position: null,
    plannedFor: null,
  };
}

export function buildQueue(db: Db, now = new Date()): QueueItem[] {
  const items: QueueItem[] = [];

  const proposed = db.select().from(actions).where(eq(actions.status, "proposed")).all();
  const withAction = new Set<string>();
  for (const action of proposed) {
    if (!action.signalId) continue;
    const signal = db.select().from(signals).where(eq(signals.id, action.signalId)).get();
    if (!signal) continue;
    withAction.add(signal.id);
    items.push(buildItem(db, signal, action, now));
  }

  const since = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * 86_400_000).toISOString();
  const attention = db
    .select({ signal: signals, thoughtState: thoughts.state })
    .from(signals)
    .leftJoin(thoughts, eq(thoughts.id, signals.thoughtId))
    .where(
      and(
        isNull(signals.reviewedAt),
        inArray(signals.disposition, ["promoted", "escalated"]),
        gte(signals.receivedAt, since),
      ),
    )
    .orderBy(desc(signals.receivedAt))
    .limit(MAX_ITEMS)
    .all();
  for (const { signal, thoughtState } of attention) {
    if (withAction.has(signal.id) || thoughtState === "closed") continue;
    items.push(buildItem(db, signal, null, now));
  }

  const positions = new Map(
    db
      .select()
      .from(queueOrder)
      .all()
      .map((r) => [r.itemId, r.position] as const),
  );
  for (const item of items) item.position = positions.get(item.id) ?? null;

  const plans = new Map(
    db
      .select()
      .from(queuePlan)
      .all()
      .map((r) => [r.itemId, r.plannedDate] as const),
  );
  for (const item of items) item.plannedFor = plans.get(item.id) ?? null;

  // New (unpositioned) items come first, most pressing first, so they are
  // noticed; items the operator has ordered keep their saved order below.
  const byDefault = (a: QueueItem, b: QueueItem) =>
    BUCKET_RANK[a.timing.bucket] - BUCKET_RANK[b.timing.bucket] ||
    (a.timing.actBy ?? "9999").localeCompare(b.timing.actBy ?? "9999") ||
    a.queuedAt.localeCompare(b.queuedAt);

  const unpositioned = items.filter((i) => i.position === null).sort(byDefault);
  const positioned = items
    .filter((i) => i.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number));
  return [...unpositioned, ...positioned].slice(0, MAX_ITEMS);
}

export function queueRouter(db: Db) {
  const app = new Hono();

  app.get("/", (c) => c.json(buildQueue(db)));

  // The extension may show only some items (Today, Backlog...), so `ids` is
  // the visible subset in its new order. Those ids are put back into the
  // slots they already occupied; items that were not shown keep their slot.
  app.put("/order", zValidator("json", OrderSchema), (c) => {
    const { ids } = c.req.valid("json");
    const current = buildQueue(db).map((i) => i.id);
    const known = new Set(current);
    const reordered = [...new Set(ids)].filter((id) => known.has(id));
    const slots = new Set(reordered);
    let next = 0;
    const merged = current.map((id) => (slots.has(id) ? reordered[next++]! : id));

    db.transaction((tx) => {
      tx.delete(queueOrder).run();
      merged.forEach((itemId, position) => {
        tx.insert(queueOrder).values({ itemId, position }).run();
      });
    });
    return c.json({ ok: true, count: merged.length });
  });

  app.put("/plan", zValidator("json", PlanSchema), (c) => {
    const { ids, date } = c.req.valid("json");
    const current = new Set(buildQueue(db).map((i) => i.id));
    const targets = [...new Set(ids)].filter((id) => current.has(id));

    db.transaction((tx) => {
      for (const itemId of targets) {
        if (date === null) {
          tx.delete(queuePlan).where(eq(queuePlan.itemId, itemId)).run();
        } else {
          tx.insert(queuePlan)
            .values({ itemId, plannedDate: date })
            .onConflictDoUpdate({ target: queuePlan.itemId, set: { plannedDate: date } })
            .run();
        }
      }
      // Plans for items that have left the queue are no longer meaningful.
      for (const row of tx.select().from(queuePlan).all()) {
        if (!current.has(row.itemId))
          tx.delete(queuePlan).where(eq(queuePlan.itemId, row.itemId)).run();
      }
    });
    return c.json({ ok: true, planned: targets.length, date });
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const item = buildQueue(db).find((i) => i.id === id);
    if (!item) return c.json({ error: "Not in the queue (already resolved?)" }, 404);

    const signal = db.select().from(signals).where(eq(signals.id, item.signalId)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    // Every message in this conversation, plus anything linked to the same thought.
    const related = db
      .select()
      .from(signals)
      .where(
        signal.threadId && signal.thoughtId
          ? sql`${signals.threadId} = ${signal.threadId} or ${signals.thoughtId} = ${signal.thoughtId}`
          : signal.threadId
            ? eq(signals.threadId, signal.threadId)
            : signal.thoughtId
              ? eq(signals.thoughtId, signal.thoughtId)
              : eq(signals.id, signal.id),
      )
      .orderBy(asc(signals.receivedAt))
      .limit(50)
      .all()
      .map((s) => ({
        id: s.id,
        adapter: s.adapter,
        account: s.account,
        sender: s.sender,
        subject: s.subject,
        body: s.body.slice(0, 2000),
        receivedAt: s.receivedAt,
        disposition: s.disposition,
        current: s.id === signal.id,
      }));

    const thought = signal.thoughtId
      ? (db.select().from(thoughts).where(eq(thoughts.id, signal.thoughtId)).get() ?? null)
      : null;

    const direction = signal.directionId
      ? (db.select().from(directions).where(eq(directions.id, signal.directionId)).get() ?? null)
      : null;

    const threadCondition = signal.threadId
      ? sql` or json_extract(${events.payload}, '$.threadId') = ${signal.threadId}`
      : sql``;
    const history = db
      .select()
      .from(events)
      .where(sql`json_extract(${events.payload}, '$.signalId') = ${signal.id}${threadCondition}`)
      .orderBy(desc(events.at))
      .all();

    const allActions = db.select().from(actions).where(eq(actions.signalId, signal.id)).all();
    const proposed = item.actionId ? allActions.find((a) => a.id === item.actionId) : undefined;

    return c.json({
      item,
      signal: {
        id: signal.id,
        sender: signal.sender,
        recipients: signal.recipients,
        subject: signal.subject,
        body: signal.body,
        transformedSummary: signal.transformedSummary,
        kind: signal.kind,
        receivedAt: signal.receivedAt,
        disposition: signal.disposition,
        escalateBy: signal.escalateBy,
      },
      draft: proposed ? draftBody(proposed.payload) : null,
      thread: related,
      thought: thought
        ? {
            id: thought.id,
            title: thought.title,
            body: thought.body,
            state: thought.state,
            nextAction: thought.nextAction,
            reviewAt: thought.reviewAt,
            disputedReason: thought.disputedReason,
            commitment: parseCommitment(thought.commitment),
          }
        : null,
      direction: direction
        ? {
            id: direction.id,
            name: direction.name,
            posture: direction.posture,
            autonomy: direction.autonomy,
            standard: direction.standard,
          }
        : null,
      actions: allActions.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        createdAt: a.createdAt,
        sentAt: a.sentAt,
      })),
      events: history,
    });
  });

  return app;
}
