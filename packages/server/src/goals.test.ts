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
import { events, signals, thoughts } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-goals-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-goals-data-"));

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "migrations");

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
      id, adapter: "gmail", externalId: id, sender: "a@example.com", recipients: "[]", kind: "email",
      body: "hello", receivedAt: new Date().toISOString(), disposition: "promoted", dedupeKey: id,
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

describe("linking a signal to a goal", () => {
  it("PUT /signals/:id/thought links it and DELETE unlinks it", async () => {
    const { call, db } = setup();
    db.insert(thoughts).values({ id: "g1", title: "Goal", body: "", state: "goal" }).run();
    const id = addSignal(db);

    expect((await call(`/signals/${id}/thought`, put({ thoughtId: "g1" }))).status).toBe(200);
    expect(db.select().from(signals).where(eq(signals.id, id)).get()?.thoughtId).toBe("g1");

    expect((await call(`/signals/${id}/thought`, { method: "DELETE" })).status).toBe(200);
    expect(db.select().from(signals).where(eq(signals.id, id)).get()?.thoughtId).toBeNull();
    expect(db.select().from(events).all().map((e) => e.kind)).toEqual(
      expect.arrayContaining(["signal.thought_linked", "signal.thought_unlinked"]),
    );
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

    const items = (await (await call("/queue")).json()) as { signalId: string; goalId: string | null }[];
    expect(items.find((i) => i.signalId === linked)?.goalId).toBe("g1");
    expect(items.find((i) => i.signalId === plain)?.goalId).toBeNull();
  });
});

describe("auto-link settings", () => {
  it("defaults to on at 0.8 and round-trips a change", async () => {
    const { call } = setup();
    expect(await (await call("/admin/autolink")).json()).toEqual({ enabled: true, threshold: 0.8 });
    expect((await call("/admin/autolink", put({ enabled: false, threshold: 0.9 }))).status).toBe(200);
    expect(await (await call("/admin/autolink")).json()).toEqual({ enabled: false, threshold: 0.9 });
  });

  it("rejects a threshold below 0.5", async () => {
    const { call } = setup();
    expect((await call("/admin/autolink", put({ enabled: true, threshold: 0.2 }))).status).toBe(400);
  });
});
