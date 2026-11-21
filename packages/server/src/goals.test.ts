import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { events, signals, thoughts } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-goals-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-goals-data-"));

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const app = buildApp(db, new AdapterRegistry());
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${auth.getToken()}`, "Content-Type": "application/json" },
    });
  return { db, call };
}

let n = 0;
function addSignal(db: ReturnType<typeof setup>["db"]) {
  const id = `s${++n}`;
  db.insert(signals)
    .values({
      id,
      adapter: "gmail",
      externalId: id,
      sender: "a@example.com",
      recipients: "[]",
      kind: "email",
      body: "hello",
      receivedAt: new Date().toISOString(),
      disposition: "promoted",
      dedupeKey: id,
    })
    .run();
  return id;
}

const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });

describe("creating a goal", () => {
  it("POST /thoughts with state goal creates a Thought in the goal state", async () => {
    const { call, db } = setup();
    const res = await call("/thoughts", {
      method: "POST",
      body: JSON.stringify({ title: "Ship Q4 report", body: "", directionId: null, state: "goal" }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(db.select().from(thoughts).where(eq(thoughts.id, id)).get()?.state).toBe("goal");
  });

  it("defaults to a seedling when no state is given", async () => {
    const { call, db } = setup();
    const res = await call("/thoughts", {
      method: "POST",
      body: JSON.stringify({ title: "x", body: "", directionId: null }),
    });
    const { id } = (await res.json()) as { id: string };
    expect(db.select().from(thoughts).where(eq(thoughts.id, id)).get()?.state).toBe("seedling");
  });
});

describe("sub-goals", () => {
  const create = (call: ReturnType<typeof setup>["call"], body: Record<string, unknown>) =>
    call("/thoughts", {
      method: "POST",
      body: JSON.stringify({ title: "Sub", body: "", directionId: null, state: "goal", ...body }),
    });

  it("creates a goal under a parent goal and lists its parentId", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    const res = await create(call, { parentId: "g1" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(db.select().from(thoughts).where(eq(thoughts.id, id)).get()?.parentId).toBe("g1");
    const listed = (await (await call("/thoughts?state=goal")).json()) as {
      id: string;
      parentId: string | null;
    }[];
    expect(listed.find((g) => g.id === id)?.parentId).toBe("g1");
    expect(listed.find((g) => g.id === "g1")?.parentId).toBeNull();
  });

  it("rejects a parent that does not exist or is not a goal", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "t1", title: "Plain", body: "", state: "seedling" }).run();
    expect((await create(call, { parentId: "missing" })).status).toBe(400);
    expect((await create(call, { parentId: "t1" })).status).toBe(400);
  });

  it("lets a signal link to a sub-goal and reports it as its goalId", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    db.insert(thoughts)
      .values({ id: "g2", title: "Sub", body: "", state: "goal", parentId: "g1" })
      .run();
    const id = addSignal(db);
    expect((await call(`/signals/${id}/thought`, put({ thoughtId: "g2" }))).status).toBe(200);
    const items = (await (await call("/queue")).json()) as {
      signalId: string;
      goalId: string | null;
    }[];
    expect(items.find((i) => i.signalId === id)?.goalId).toBe("g2");
  });
});

describe("linking a signal to a goal", () => {
  it("PUT /signals/:id/thought links it and DELETE unlinks it", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    const id = addSignal(db);

    expect((await call(`/signals/${id}/thought`, put({ thoughtId: "g1" }))).status).toBe(200);
    expect(db.select().from(signals).where(eq(signals.id, id)).get()?.thoughtId).toBe("g1");

    expect((await call(`/signals/${id}/thought`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(signals).where(eq(signals.id, id)).get()?.thoughtId).toBeNull();
    expect(
      db
        .select()
        .from(events)
        .all()
        .map((e) => e.kind),
    ).toEqual(expect.arrayContaining(["signal.thought_linked", "signal.thought_unlinked"]));
  });
});

describe("GET /queue goal link", () => {
  it("reports goalId only when the signal's thought is a goal", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    db.insert(thoughts).values({ id: "t1", title: "Plain", body: "", state: "active" }).run();
    const linked = addSignal(db);
    const plain = addSignal(db);
    db.update(signals).set({ thoughtId: "g1" }).where(eq(signals.id, linked)).run();
    db.update(signals).set({ thoughtId: "t1" }).where(eq(signals.id, plain)).run();

    const items = (await (await call("/queue")).json()) as {
      signalId: string;
      goalId: string | null;
    }[];
    expect(items.find((i) => i.signalId === linked)?.goalId).toBe("g1");
    expect(items.find((i) => i.signalId === plain)?.goalId).toBeNull();
  });
});

describe("PATCH /thoughts/:id title and parentId", () => {
  const patch = (call: ReturnType<typeof setup>["call"], id: string, body: unknown) =>
    call(`/thoughts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  const row = (db: ReturnType<typeof setup>["db"], id: string) =>
    db.select().from(thoughts).where(eq(thoughts.id, id)).get();

  function seed() {
    const ctx = setup();
    for (const id of ["g1", "g2", "g3"]) {
      ctx.db.insert(thoughts).values({ id, title: id, body: "", state: "goal" }).run();
    }
    ctx.db.update(thoughts).set({ parentId: "g2" }).where(eq(thoughts.id, "g3")).run();
    return ctx;
  }

  it("renames a goal and trims the title", async () => {
    const { call, db } = seed();
    expect((await patch(call, "g1", { title: "  Renamed  " })).status).toBe(200);
    expect(row(db, "g1")?.title).toBe("Renamed");
  });

  it("rejects an empty title", async () => {
    const { call } = seed();
    expect((await patch(call, "g1", { title: "   " })).status).toBe(400);
  });

  it("makes a goal a sub-goal and back to top-level", async () => {
    const { call, db } = seed();
    expect((await patch(call, "g1", { parentId: "g2" })).status).toBe(200);
    expect(row(db, "g1")?.parentId).toBe("g2");
    expect((await patch(call, "g1", { parentId: null })).status).toBe(200);
    expect(row(db, "g1")?.parentId).toBeNull();
  });

  it("rejects a missing parent, a non-goal parent, itself, and a descendant", async () => {
    const { call, db } = seed();
    db.insert(thoughts).values({ id: "t1", title: "Plain", body: "", state: "seedling" }).run();
    expect((await patch(call, "g1", { parentId: "missing" })).status).toBe(400);
    expect((await patch(call, "g1", { parentId: "t1" })).status).toBe(400);
    expect((await patch(call, "g1", { parentId: "g1" })).status).toBe(400);
    expect((await patch(call, "g2", { parentId: "g3" })).status).toBe(400);
    expect(row(db, "g2")?.parentId).toBeNull();
  });
});

describe("GET /signals thoughtId filter", () => {
  it("returns only the signals linked to that goal, whatever their age", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    db.insert(thoughts).values({ id: "g2", title: "Other", body: "", state: "goal" }).run();
    const mine = addSignal(db);
    const old = addSignal(db);
    const other = addSignal(db);
    addSignal(db);
    db.update(signals).set({ thoughtId: "g1" }).where(eq(signals.id, mine)).run();
    db.update(signals)
      .set({ thoughtId: "g1", receivedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(signals.id, old))
      .run();
    db.update(signals).set({ thoughtId: "g2" }).where(eq(signals.id, other)).run();

    const rows = (await (await call("/signals?range=all&thoughtId=g1")).json()) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([mine, old].sort());
  });
});

describe("auto-link settings", () => {
  it("defaults to on at 0.8 and round-trips a change", async () => {
    const { call } = setup();
    expect(await (await call("/admin/autolink")).json()).toEqual({ enabled: true, threshold: 0.8 });
    expect((await call("/admin/autolink", put({ enabled: false, threshold: 0.9 }))).status).toBe(
      200,
    );
    expect(await (await call("/admin/autolink")).json()).toEqual({
      enabled: false,
      threshold: 0.9,
    });
  });

  it("rejects a threshold below 0.5", async () => {
    const { call } = setup();
    expect((await call("/admin/autolink", put({ enabled: true, threshold: 0.2 }))).status).toBe(
      400,
    );
  });
});

describe("GET /metrics autoLink", () => {
  it("reports automatic links the operator later undid", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    const kept = addSignal(db);
    const undone = addSignal(db);
    const event = (at: string, actor: string, kind: string, payload: object) =>
      db
        .insert(events)
        .values({ id: `e${at}`, at, actor, kind, payload: JSON.stringify(payload) })
        .run();
    const now = Date.now();
    const iso = (offset: number) => new Date(now - 1000 + offset).toISOString();
    event(iso(0), "system", "signal.thought_linked", {
      signalId: kept,
      thoughtId: "g1",
      auto: true,
      promptVersion: 2,
    });
    event(iso(1), "system", "signal.thought_linked", {
      signalId: undone,
      thoughtId: "g1",
      auto: true,
      promptVersion: 2,
    });
    event(iso(2), "user", "signal.thought_unlinked", { signalId: undone });

    const body = (await (await call("/metrics")).json()) as {
      autoLink: { autoLinks: number; corrected: number; rate: number | null };
    };
    expect(body.autoLink).toMatchObject({ autoLinks: 2, corrected: 1, rate: 0.5 });
  });
});
