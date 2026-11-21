import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { actions, directions, events, signals, thoughts } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";
import { queueTiming } from "./queue-timing.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-queue-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-queue-data-"));

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);
// Real clock: the queue reads the current time, so fixtures are relative to it.
const NOW = new Date();

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const app = buildApp(db, new AdapterRegistry());
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.getToken()}`,
        "Content-Type": "application/json",
      },
    });
  return { db, call };
}

let n = 0;
function addDirection(db: ReturnType<typeof setup>["db"], signalActions: unknown[] | null = null) {
  const id = `d${++n}`;
  db.insert(directions)
    .values({
      id,
      name: id,
      scopeKind: "topic",
      scopeValue: "x",
      posture: "surface",
      standard: "s",
      autonomy: "observe",
      confidenceMin: 0.5,
      enabled: true,
      version: 1,
      signalActions: signalActions ? JSON.stringify(signalActions) : null,
    })
    .run();
  return id;
}

function addSignal(
  db: ReturnType<typeof setup>["db"],
  over: Partial<typeof signals.$inferInsert> = {},
) {
  const id = `s${++n}`;
  db.insert(signals)
    .values({
      id,
      adapter: "gmail:75a788d4",
      account: "75a788d4",
      externalId: id,
      threadId: null,
      sender: "a@example.com",
      recipients: "[]",
      kind: "email",
      body: "hello",
      receivedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      disposition: "promoted",
      dedupeKey: id,
      ...over,
    })
    .run();
  return id;
}

function addAction(db: ReturnType<typeof setup>["db"], signalId: string) {
  const id = `a${++n}`;
  db.insert(actions)
    .values({
      id,
      signalId,
      kind: "reply",
      payload: JSON.stringify({ to: ["a@example.com"], body: "Thanks, noted." }),
      status: "proposed",
      adapter: "gmail:75a788d4",
      account: "75a788d4",
    })
    .run();
  return id;
}

describe("queueTiming", () => {
  const t = (over: Partial<Parameters<typeof queueTiming>[0]>) =>
    queueTiming(
      { type: "attention", signalKind: "information", urgency: "low", escalateBy: null, ...over },
      NOW,
    );

  it("treats an informational signal with no deadline as able to wait, and says why", () => {
    const r = t({});
    expect(r.bucket).toBe("can-wait");
    expect(r.reason).toMatch(/changes no decision/);
    expect(r.actBy).toBeNull();
  });

  it("buckets by deadline", () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
    expect(t({ escalateBy: at(-2) }).bucket).toBe("now");
    expect(t({ escalateBy: at(-2) }).reason).toMatch(/passed 2 h ago/);
    expect(t({ escalateBy: at(3) }).bucket).toBe("now");
    expect(t({ escalateBy: at(20) }).bucket).toBe("today");
    expect(t({ escalateBy: at(24 * 5) }).bucket).toBe("this-week");
    expect(t({ escalateBy: at(24 * 30) }).bucket).toBe("can-wait");
  });

  it("puts an unanswered question today and a low-urgency one this week", () => {
    expect(t({ signalKind: "question", urgency: "normal" }).bucket).toBe("today");
    expect(t({ signalKind: "question", urgency: "low" }).bucket).toBe("this-week");
  });

  it("treats high urgency as today even for information", () => {
    expect(t({ urgency: "high" }).bucket).toBe("today");
  });
});

describe("GET /queue", () => {
  it("lists replies and unacknowledged attention signals, not filed or reviewed ones", async () => {
    const { db, call } = setup();
    const withDraft = addSignal(db, { disposition: "absorbed" });
    const draftId = addAction(db, withDraft);
    const surfaced = addSignal(db);
    addSignal(db, { disposition: "filed" });
    addSignal(db, { reviewedAt: NOW.toISOString() });
    addSignal(db, { receivedAt: "2020-01-01T00:00:00.000Z" });

    const items = (await (await call("/queue")).json()) as Array<{ id: string; type: string }>;
    expect(items.map((i) => i.id).sort()).toEqual(
      [`action:${draftId}`, `signal:${surfaced}`].sort(),
    );
    expect(items.find((i) => i.id === `action:${draftId}`)?.type).toBe("reply");
  });

  it("gives a plain reply approve/discard and a plain attention item acknowledge", async () => {
    const { db, call } = setup();
    addAction(db, addSignal(db, { disposition: "absorbed" }));
    addSignal(db);

    const items = (await (await call("/queue")).json()) as Array<{
      type: string;
      actions: Array<{ kind: string }>;
    }>;
    expect(items.find((i) => i.type === "reply")?.actions.map((a) => a.kind)).toEqual([
      "approve",
      "discard",
    ]);
    expect(items.find((i) => i.type === "attention")?.actions.map((a) => a.kind)).toEqual([
      "acknowledge",
    ]);
  });

  it("uses the direction's declared actions instead, flagging whether the link is present", async () => {
    const { db, call } = setup();
    const prefix = "https://accounts.google.com/AccountDisavow?adt=";
    const dir = addDirection(db, [
      { id: "ack", label: "Acknowledge", kind: "acknowledge" },
      { id: "disavow", label: "Disavow", kind: "openLink", linkPrefix: prefix },
    ]);
    addSignal(db, { directionId: dir, body: `go to ${prefix}abc` });
    addSignal(db, { directionId: dir, body: "no link here" });

    const items = (await (await call("/queue")).json()) as Array<{
      actions: Array<{ id: string; linkAvailable?: boolean }>;
    }>;
    const flags = items.map((i) => i.actions.find((a) => a.id === "disavow")?.linkAvailable).sort();
    expect(flags).toEqual([false, true]);
    expect(items[0]!.actions.map((a) => a.id)).toEqual(["ack", "disavow"]);
  });

  it("carries the transformed summary, direction name and timing", async () => {
    const { db, call } = setup();
    const dir = addDirection(db);
    addSignal(db, {
      directionId: dir,
      transformedSummary: "account sign-in on Linux - a@b.c - none",
    });
    const [item] = (await (await call("/queue")).json()) as Array<{
      summary: string;
      direction: { name: string };
      timing: { bucket: string };
    }>;
    expect(item!.summary).toBe("account sign-in on Linux - a@b.c - none");
    expect(item!.direction.name).toBe(dir);
    expect(item!.timing.bucket).toBe("can-wait");
  });

  it("sorts most pressing first by default", async () => {
    const { db, call } = setup();
    const late = addSignal(db, {
      escalateBy: new Date(NOW.getTime() + 20 * 3_600_000).toISOString(),
    });
    const none = addSignal(db);
    const soon = addSignal(db, { escalateBy: new Date(Date.now() + 3_600_000).toISOString() });
    const items = (await (await call("/queue")).json()) as Array<{ signalId: string }>;
    expect(items.map((i) => i.signalId)).toEqual([soon, late, none]);
  });
});

describe("PUT /queue/order", () => {
  it("keeps the dragged order, and puts new items above it", async () => {
    const { db, call } = setup();
    const a = addSignal(db);
    const b = addSignal(db);
    const c = addSignal(db);

    const put = await call("/queue/order", {
      method: "PUT",
      body: JSON.stringify({ ids: [`signal:${c}`, `signal:${a}`, `signal:${b}`] }),
    });
    expect(put.status).toBe(200);

    let items = (await (await call("/queue")).json()) as Array<{ signalId: string }>;
    expect(items.map((i) => i.signalId)).toEqual([c, a, b]);

    const fresh = addSignal(db);
    items = (await (await call("/queue")).json()) as Array<{ signalId: string }>;
    expect(items.map((i) => i.signalId)).toEqual([fresh, c, a, b]);
  });

  it("rejects malformed ids", async () => {
    const { call } = setup();
    const res = await call("/queue/order", {
      method: "PUT",
      body: JSON.stringify({ ids: ["x; drop table"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /queue/:id", () => {
  it("returns the thread, thought, history and full draft", async () => {
    const { db, call } = setup();
    db.insert(thoughts).values({ id: "t1", title: "Budget question", state: "active" }).run();
    const earlier = addSignal(db, {
      threadId: "th1",
      receivedAt: new Date(NOW.getTime() - 7_200_000).toISOString(),
      thoughtId: "t1",
    });
    const current = addSignal(db, { threadId: "th1", disposition: "absorbed", thoughtId: "t1" });
    const actionId = addAction(db, current);
    db.insert(events)
      .values({
        id: "e1",
        actor: "system",
        kind: "signal.processed",
        payload: JSON.stringify({
          signalId: current,
          intent: "status request",
          urgency: "normal",
          signalKind: "question",
        }),
      })
      .run();

    const res = await call(`/queue/action:${actionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { assessment: { intent: string } };
      draft: string;
      thread: Array<{ id: string; current: boolean }>;
      thought: { title: string };
      events: Array<{ kind: string }>;
    };
    expect(body.item.assessment.intent).toBe("status request");
    expect(body.draft).toBe("Thanks, noted.");
    expect(body.thread.map((s) => [s.id, s.current])).toEqual([
      [earlier, false],
      [current, true],
    ]);
    expect(body.thought.title).toBe("Budget question");
    expect(body.events.map((e) => e.kind)).toContain("signal.processed");
  });

  it("404s for an item that is no longer in the queue", async () => {
    const { call } = setup();
    expect((await call("/queue/signal:gone")).status).toBe(404);
  });
});

describe("POST /signals/:id/acknowledge", () => {
  it("removes the item, closes the thought, and dismisses (not discards) the draft", async () => {
    const { db, call } = setup();
    db.insert(thoughts).values({ id: "t2", title: "x", state: "seedling" }).run();
    const sig = addSignal(db, { thoughtId: "t2", disposition: "absorbed" });
    const actionId = addAction(db, sig);

    const res = await call(`/signals/${sig}/acknowledge`, { method: "POST" });
    expect(res.status).toBe(200);

    expect(db.select().from(signals).where(eq(signals.id, sig)).get()?.reviewedAt).not.toBeNull();
    expect(db.select().from(thoughts).where(eq(thoughts.id, "t2")).get()?.state).toBe("closed");
    expect(db.select().from(actions).where(eq(actions.id, actionId)).get()?.status).toBe(
      "dismissed",
    );
    expect(
      db.select().from(events).where(eq(events.kind, "signal.acknowledged")).all(),
    ).toHaveLength(1);
    expect(await (await call("/queue")).json()).toEqual([]);
  });

  it("404s for an unknown signal", async () => {
    const { call } = setup();
    expect((await call("/signals/nope/acknowledge", { method: "POST" })).status).toBe(404);
  });
});

describe("PUT /queue/plan", () => {
  const put = (call: ReturnType<typeof setup>["call"], ids: string[], date: string | null) =>
    call("/queue/plan", { method: "PUT", body: JSON.stringify({ ids, date }) });
  const planned = async (call: ReturnType<typeof setup>["call"]) =>
    (await (await call("/queue")).json()) as Array<{ signalId: string; plannedFor: string | null }>;

  it("plans items for a day, leaves the rest in the backlog, and can clear a plan", async () => {
    const { db, call } = setup();
    const a = addSignal(db);
    const b = addSignal(db);

    expect((await put(call, [`signal:${a}`], "2026-11-20")).status).toBe(200);
    let items = await planned(call);
    expect(items.find((i) => i.signalId === a)?.plannedFor).toBe("2026-11-20");
    expect(items.find((i) => i.signalId === b)?.plannedFor).toBeNull();

    await put(call, [`signal:${a}`], null);
    items = await planned(call);
    expect(items.every((i) => i.plannedFor === null)).toBe(true);
  });

  it("plans several items in one call", async () => {
    const { db, call } = setup();
    const a = addSignal(db);
    const b = addSignal(db);
    await put(call, [`signal:${a}`, `signal:${b}`], "2026-11-21");
    expect((await planned(call)).map((i) => i.plannedFor)).toEqual(["2026-11-21", "2026-11-21"]);
  });

  it.each(["2026-13-01", "2026-02-30", "tomorrow", "2026-1-5"])(
    "rejects the date %s",
    async (date) => {
      const { db, call } = setup();
      const a = addSignal(db);
      expect((await put(call, [`signal:${a}`], date)).status).toBe(400);
    },
  );

  it("drops the plan once the item leaves the queue", async () => {
    const { db, call } = setup();
    const a = addSignal(db);
    const b = addSignal(db);
    await put(call, [`signal:${a}`], "2026-11-20");
    await call(`/signals/${a}/acknowledge`, { method: "POST" });
    await put(call, [`signal:${b}`], "2026-11-21");
    expect(
      db
        .select()
        .from(schema.queuePlan)
        .all()
        .map((r) => r.itemId),
    ).toEqual([`signal:${b}`]);
  });
});

describe("PUT /queue/order with a filtered view", () => {
  it("reorders only the visible items and keeps the others in their slots", async () => {
    const { db, call } = setup();
    const [a, b, c, d] = [addSignal(db), addSignal(db), addSignal(db), addSignal(db)];
    const all = [a, b, c, d].map((s) => `signal:${s}`);
    await call("/queue/order", { method: "PUT", body: JSON.stringify({ ids: all }) });

    // The view shows only a and c; the operator drags c above a.
    await call("/queue/order", {
      method: "PUT",
      body: JSON.stringify({ ids: [`signal:${c}`, `signal:${a}`] }),
    });

    const items = (await (await call("/queue")).json()) as Array<{ signalId: string }>;
    expect(items.map((i) => i.signalId)).toEqual([c, b, a, d]);
  });
});
