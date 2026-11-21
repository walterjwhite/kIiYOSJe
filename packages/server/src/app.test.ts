/**
 * Integration tests for the Hono application.
 * Uses an in-memory database — no file I/O, no migration folder dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { mkdtempSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { notificationsConfigPath, displaySettingsPath } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";

// Point to core's migrations
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

// Override the token for tests
process.env["MIND_TEST_TOKEN"] = "test-token";
// Keep paths and provider choice local to the suite: no shared config files,
// and a cloud provider with no key so classify()/draft() stay on the stub path.
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-app-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-app-data-"));
process.env["MIND_AI_PROVIDER"] = "openai";
// Direction edits write back to YAML; never let a test touch the repo's files.
process.env["MIND_DIRECTIONS_DIR"] = mkdtempSync(join(tmpdir(), "mind-app-directions-"));
delete process.env["OPENAI_API_KEY"];
delete process.env["MIND_AI_API_KEY"];

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

// Inject a known token for tests by monkey-patching the auth module
// (simpler than mocking the filesystem in this context)
import * as auth from "./auth.js";

describe("/health", () => {
  it("returns 401 without a token", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);

    const res = await app.request("/health");
    expect(res.status).toBe(401);
  });
});

describe("/thoughts", () => {
  it("creates and retrieves a thought", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);

    // We need a valid token; read it from the auth module's exported function
    const token = auth.getToken();

    const createRes = await app.request("/thoughts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test thought",
        body: "Some body",
        directionId: null,
      }),
    });

    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };
    expect(typeof id).toBe("string");

    const listRes = await app.request("/thoughts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string }[];
    expect(list.some((t) => t.id === id)).toBe(true);
  });
});

describe("/directions", () => {
  function insertDirection(db: ReturnType<typeof openTestDb>) {
    db.insert(schema.directions)
      .values({
        id: "work/boss",
        name: "boss-requests",
        scopeKind: "person",
        scopeValue: "boss@corp.example",
        posture: "absorb",
        standard: "Original guidance.",
        autonomy: "draft",
        confidenceMin: 0.7,
        enabled: true,
        version: 1,
      })
      .run();
  }

  it("edits scope, posture, and autonomy via PUT", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();
    insertDirection(db);

    const res = await app.request("/directions/work%2Fboss", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scopeKind: "project",
        scopeValue: "platform-team",
        posture: "surface",
        autonomy: "observe",
      }),
    });
    expect(res.status).toBe(200);

    const updated = db
      .select()
      .from(schema.directions)
      .where(eq(schema.directions.id, "work/boss"))
      .get();
    expect(updated?.scopeKind).toBe("project");
    expect(updated?.scopeValue).toBe("platform-team");
    expect(updated?.posture).toBe("surface");
    expect(updated?.autonomy).toBe("observe");
  });

  it("accepts 'guidance' as an alias for 'standard' on PUT", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();
    insertDirection(db);

    const res = await app.request("/directions/work%2Fboss", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ guidance: "Updated guidance via alias." }),
    });
    expect(res.status).toBe(200);

    const updated = db
      .select()
      .from(schema.directions)
      .where(eq(schema.directions.id, "work/boss"))
      .get();
    expect(updated?.standard).toBe("Updated guidance via alias.");
  });

  it("creates, edits, and deletes a direction through its YAML file", async () => {
    const db = openTestDb();
    const app = buildApp(db, new AdapterRegistry());
    const headers = {
      Authorization: `Bearer ${auth.getToken()}`,
      "Content-Type": "application/json",
    };
    const dir = process.env["MIND_DIRECTIONS_DIR"] as string;
    const file = join(dir, "mine", "rule.yaml");

    const created = await app.request("/directions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "mine/rule",
        config: {
          name: "rule",
          scope: { kind: "topic", value: "invoice" },
          posture: "absorb",
          autonomy: "draft",
          standard: "Reply politely.",
        },
      }),
    });
    expect(created.status).toBe(201);
    expect(existsSync(file)).toBe(true);
    expect(
      db.select().from(schema.directions).where(eq(schema.directions.id, "mine/rule")).get()?.name,
    ).toBe("rule");

    const put = await app.request("/directions/mine%2Frule", {
      method: "PUT",
      headers,
      body: JSON.stringify({ posture: "surface" }),
    });
    expect(put.status).toBe(200);
    expect(readFileSync(file, "utf8")).toContain("posture: surface");

    const del = await app.request("/directions/mine%2Frule", { method: "DELETE", headers });
    expect(del.status).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(file + ".deleted")).toBe(true);
    expect(
      db.select().from(schema.directions).where(eq(schema.directions.id, "mine/rule")).get(),
    ).toBeUndefined();
  });

  it("rejects path-traversal ids and deleting the catch-all", async () => {
    const db = openTestDb();
    const app = buildApp(db, new AdapterRegistry());
    const headers = {
      Authorization: `Bearer ${auth.getToken()}`,
      "Content-Type": "application/json",
    };
    const bad = await app.request("/directions", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "../evil", config: {} }),
    });
    expect(bad.status).toBe(400);
    const del = await app.request("/directions/system%2Fcatch-all", { method: "DELETE", headers });
    expect(del.status).toBe(400);
  });

  it("reports where direction files live", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const res = await app.request("/directions/source", {
      headers: { Authorization: `Bearer ${auth.getToken()}` },
    });
    expect(((await res.json()) as { dir: string }).dir).toBe(process.env["MIND_DIRECTIONS_DIR"]);
  });
});

describe("/metrics", () => {
  it("returns metric fields", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("signals");
    expect(body).toHaveProperty("thoughts");
    expect(body).toHaveProperty("window");
    expect(body).toHaveProperty("byChannel");
    expect(body).toHaveProperty("dailyVolume");
  });
});

describe("/metrics/signals (Analytics drill-down)", () => {
  it("rejects a request with no filter", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/metrics/signals", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns signals matching a directionId filter", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.directions)
      .values({
        id: "dir-a",
        name: "A",
        scopeKind: "topic",
        scopeValue: "x",
        posture: "surface",
        standard: "s",
        autonomy: "observe",
        confidenceMin: 0.5,
        enabled: true,
        version: 1,
      })
      .run();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: "dir-a",
        dedupeKey: "test:e1",
      })
      .run();

    const res = await app.request("/metrics/signals?directionId=dir-a", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.some((r) => r.id === "sig-1")).toBe(true);
  });
});

describe("/signals (list + reclassify)", () => {
  it("returns the full ingest result for a new signal", async () => {
    const db = openTestDb();
    const app = buildApp(db, new AdapterRegistry());
    const token = auth.getToken();

    const res = await app.request("/signals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        adapter: "test",
        externalId: "ingress-1",
        threadId: null,
        sender: "alice@example.com",
        recipients: ["me@example.com"],
        kind: "message",
        body: "Where is the rollout?",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      disposition: string;
      signalId: string | null;
      thoughtId: string | null;
      actionId: string | null;
      reason: string;
    };
    expect(body.disposition).not.toBe("duplicate");
    expect(body.signalId).toBeTruthy();
    expect(body.reason.length).toBeGreaterThan(0);
  });

  it("lists signals and reclassifies one to a different direction", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.directions)
      .values([
        {
          id: "dir-a",
          name: "A",
          scopeKind: "topic",
          scopeValue: "x",
          posture: "surface",
          standard: "s",
          autonomy: "observe",
          confidenceMin: 0.5,
          enabled: true,
          version: 1,
        },
        {
          id: "dir-b",
          name: "B",
          scopeKind: "topic",
          scopeValue: "y",
          posture: "surface",
          standard: "s",
          autonomy: "observe",
          confidenceMin: 0.5,
          enabled: true,
          version: 1,
        },
      ])
      .run();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: "dir-a",
        dedupeKey: "test:e1",
      })
      .run();

    const listRes = await app.request("/signals?range=all", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string }[];
    expect(list.some((s) => s.id === "sig-1")).toBe(true);

    const patchRes = await app.request("/signals/sig-1", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ directionId: "dir-b", reason: "wrong match" }),
    });
    expect(patchRes.status).toBe(200);

    const updated = db.select().from(schema.signals).where(eq(schema.signals.id, "sig-1")).get();
    expect(updated?.directionId).toBe("dir-b");

    const eventsRes = await app.request("/events?kind=signal.reclassified", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(eventsRes.status).toBe(200);
    const evs = (await eventsRes.json()) as { kind: string }[];
    expect(evs.length).toBe(1);
  });

  it("filters by hour-granularity range (1h/4h/12h)", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString();

    db.insert(schema.signals)
      .values([
        {
          id: "sig-recent",
          adapter: "test",
          externalId: "e-recent",
          threadId: null,
          sender: "a@example.com",
          recipients: JSON.stringify([]),
          kind: "message",
          body: "recent",
          receivedAt: twoHoursAgo,
          urgencyHint: null,
          dedupeKey: "test:e-recent",
        },
        {
          id: "sig-older",
          adapter: "test",
          externalId: "e-older",
          threadId: null,
          sender: "a@example.com",
          recipients: JSON.stringify([]),
          kind: "message",
          body: "older",
          receivedAt: sixHoursAgo,
          urgencyHint: null,
          dedupeKey: "test:e-older",
        },
      ])
      .run();

    const res4h = await app.request("/signals?range=4h", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list4h = (await res4h.json()) as { id: string }[];
    expect(list4h.some((s) => s.id === "sig-recent")).toBe(true);
    expect(list4h.some((s) => s.id === "sig-older")).toBe(false);

    const res12h = await app.request("/signals?range=12h", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list12h = (await res12h.json()) as { id: string }[];
    expect(list12h.some((s) => s.id === "sig-recent")).toBe(true);
    expect(list12h.some((s) => s.id === "sig-older")).toBe(true);
  });

  it("filters by an explicit since/until window, overriding range", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const target = new Date(Date.now() - 10 * 3_600_000);
    db.insert(schema.signals)
      .values({
        id: "sig-window",
        adapter: "test",
        externalId: "e-window",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "windowed",
        receivedAt: target.toISOString(),
        urgencyHint: null,
        dedupeKey: "test:e-window",
      })
      .run();

    const since = new Date(target.getTime() - 3_600_000).toISOString();
    const until = new Date(target.getTime() + 3_600_000).toISOString();

    const res = await app.request(`/signals?since=${since}&until=${until}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await res.json()) as { id: string }[];
    expect(list.some((s) => s.id === "sig-window")).toBe(true);

    const missRes = await app.request(
      `/signals?since=${new Date(target.getTime() + 2 * 3_600_000).toISOString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const missList = (await missRes.json()) as { id: string }[];
    expect(missList.some((s) => s.id === "sig-window")).toBe(false);
  });

  it("rejects reclassifying to an unknown direction", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: null,
        dedupeKey: "test:e1",
      })
      .run();

    const res = await app.request("/signals/sig-1", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ directionId: "does-not-exist" }),
    });
    expect(res.status).toBe(422);
  });

  it("links a signal to an existing thought, then unlinks it", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.signals)
      .values({
        id: "sig-link-1",
        adapter: "test",
        externalId: "e-link-1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        dedupeKey: "test:e-link-1",
      })
      .run();

    db.insert(schema.thoughts)
      .values({ id: "th-1", title: "Existing thought", state: "seedling" })
      .run();

    const linkRes = await app.request("/signals/sig-link-1/thought", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ thoughtId: "th-1" }),
    });
    expect(linkRes.status).toBe(200);
    const linked = (await linkRes.json()) as { thoughtId: string; created: boolean };
    expect(linked.thoughtId).toBe("th-1");
    expect(linked.created).toBe(false);

    const afterLink = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, "sig-link-1"))
      .get();
    expect(afterLink?.thoughtId).toBe("th-1");

    const unlinkRes = await app.request("/signals/sig-link-1/thought", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unlinkRes.status).toBe(200);

    const afterUnlink = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, "sig-link-1"))
      .get();
    expect(afterUnlink?.thoughtId).toBeNull();
  });

  it("links a signal to a new thought created from a title", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.signals)
      .values({
        id: "sig-link-2",
        adapter: "test",
        externalId: "e-link-2",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        dedupeKey: "test:e-link-2",
      })
      .run();

    const res = await app.request("/signals/sig-link-2/thought", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "A brand new thought" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { thoughtId: string; created: boolean };
    expect(body.created).toBe(true);

    const thought = db
      .select()
      .from(schema.thoughts)
      .where(eq(schema.thoughts.id, body.thoughtId))
      .get();
    expect(thought?.title).toBe("A brand new thought");
  });

  it("marks a signal reviewed, then clears it", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.signals)
      .values({
        id: "sig-review-1",
        adapter: "test",
        externalId: "e-review-1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "FYI only",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "filed",
        dedupeKey: "test:e-review-1",
      })
      .run();

    const putRes = await app.request("/signals/sig-review-1/reviewed", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { reviewedAt: string };
    expect(putBody.reviewedAt).toBeTruthy();

    const afterMark = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, "sig-review-1"))
      .get();
    expect(afterMark?.reviewedAt).toBeTruthy();

    const delRes = await app.request("/signals/sig-review-1/reviewed", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status).toBe(200);

    const afterClear = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, "sig-review-1"))
      .get();
    expect(afterClear?.reviewedAt).toBeNull();
  });
});

describe("/events (Journal)", () => {
  it("lists events newest first", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.events)
      .values([
        { id: "ev-1", actor: "system", kind: "signal.processed", payload: "{}" },
        { id: "ev-2", actor: "user", kind: "action.sent", payload: "{}" },
      ])
      .run();

    const res = await app.request("/events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.length).toBe(2);
  });

  it("appends an operator note and makes it retrievable by kind", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const postRes = await app.request("/events/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Boss mentioned a reorg is coming next quarter." }),
    });
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as { id: string; at: string };
    expect(created.id).toBeTruthy();
    expect(created.at).toBeTruthy();

    const listRes = await app.request("/events?kind=journal.note", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const notes = (await listRes.json()) as { id: string; actor: string; payload: string }[];
    expect(notes.length).toBe(1);
    expect(notes[0]?.actor).toBe("user");
    expect(JSON.parse(notes[0]!.payload).text).toBe(
      "Boss mentioned a reorg is coming next quarter.",
    );
  });

  it("rejects an empty note", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/events/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("filters by range, same semantics as /signals", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString();

    db.insert(schema.events)
      .values([
        {
          id: "ev-recent",
          actor: "system",
          kind: "signal.processed",
          payload: "{}",
          at: twoHoursAgo,
        },
        {
          id: "ev-older",
          actor: "system",
          kind: "signal.processed",
          payload: "{}",
          at: sixHoursAgo,
        },
      ])
      .run();

    const res4h = await app.request("/events?range=4h", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list4h = (await res4h.json()) as { id: string }[];
    expect(list4h.some((e) => e.id === "ev-recent")).toBe(true);
    expect(list4h.some((e) => e.id === "ev-older")).toBe(false);

    const res12h = await app.request("/events?range=12h", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list12h = (await res12h.json()) as { id: string }[];
    expect(list12h.some((e) => e.id === "ev-recent")).toBe(true);
    expect(list12h.some((e) => e.id === "ev-older")).toBe(true);
  });
});

describe("/proposals/insights (stored AI-generated narratives)", () => {
  it("returns an empty list when no run has produced one", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/proposals/insights", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as unknown[];
    expect(rows).toEqual([]);
  });

  it("surfaces a stored learning.insight event, newest first", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.events)
      .values([
        {
          id: "ev-insight-older",
          actor: "system",
          kind: "learning.insight",
          at: new Date(Date.now() - 60_000).toISOString(),
          payload: JSON.stringify({
            at: new Date(Date.now() - 60_000).toISOString(),
            insight: "Older insight.",
            proposalCount: 1,
          }),
        },
        {
          id: "ev-insight-newer",
          actor: "system",
          kind: "learning.insight",
          payload: JSON.stringify({
            at: new Date().toISOString(),
            insight:
              "Override rate rose because the boss direction matched unrelated status pings.",
            proposalCount: 2,
          }),
        },
      ])
      .run();

    const res = await app.request("/proposals/insights", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { insight: string; proposalCount: number }[];
    expect(rows.length).toBe(2);
    expect(rows[0]?.insight).toContain("Override rate");
  });
});

describe("/admin/notifications (quiet period)", () => {
  // These tests read/write the real ~/.config/kIiYOSJe/mind/notifications.json,
  // same as config.ts does everywhere else (no path injection exists for
  // this module). Clean up afterward so the suite has no side effects.
  afterEach(() => {
    try {
      unlinkSync(notificationsConfigPath());
    } catch {
      /* already absent */
    }
  });

  it("returns defaults when no config has been written", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/admin/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; days: number[]; allowedNow: boolean };
    expect(body.enabled).toBe(true);
    expect(body.days).toEqual([1, 2, 3, 4, 5]);
    expect(typeof body.allowedNow).toBe("boolean");
  });

  it("rejects an invalid day value", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/admin/notifications", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        days: [7], // invalid — only 0-6
        startHour: 8,
        startMinute: 0,
        endHour: 15,
        endMinute: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("persists a custom window and reflects it back", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const putRes = await app.request("/admin/notifications", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        days: [1, 2, 3, 4, 5],
        startHour: 9,
        startMinute: 30,
        endHour: 17,
        endMinute: 0,
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/admin/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await getRes.json()) as { startHour: number; startMinute: number };
    expect(body.startHour).toBe(9);
    expect(body.startMinute).toBe(30);
  });
});

describe("/admin/display (display settings)", () => {
  afterEach(() => {
    try {
      unlinkSync(displaySettingsPath());
    } catch {
      /* already absent */
    }
  });

  it("returns defaults when no config has been written", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/admin/display", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showSubject: boolean; showCc: boolean };
    expect(body.showSubject).toBe(true);
    expect(body.showCc).toBe(true);
  });

  it("persists a custom setting and reflects it back", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const putRes = await app.request("/admin/display", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        showSubject: true,
        showCc: false,
        showBcc: false,
        preferHtmlBody: false,
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/admin/display", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await getRes.json()) as { showCc: boolean; preferHtmlBody: boolean };
    expect(body.showCc).toBe(false);
    expect(body.preferHtmlBody).toBe(false);
  });
});

describe("request guards", () => {
  it("rejects a body larger than 2 MB", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const payload = JSON.stringify({
      title: "too big",
      body: "x".repeat(2 * 1024 * 1024),
      directionId: null,
    });
    const res = await app.request("/thoughts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.getToken()}`,
        "Content-Type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
      },
      body: payload,
    });

    expect(res.status).toBe(400);
  });

  it("reports malformed JSON as a 400", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const res = await app.request("/thoughts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.getToken()}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /admin/shutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requires the bearer token and does not terminate without it", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const app = buildApp(openTestDb(), new AdapterRegistry());

    const res = await app.request("/admin/shutdown", { method: "POST" });
    expect(res.status).toBe(401);
    await vi.advanceTimersByTimeAsync(500);
    expect(kill).not.toHaveBeenCalled();
  });

  it("replies, then sends SIGTERM to its own process", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const app = buildApp(openTestDb(), new AdapterRegistry());

    const res = await app.request("/admin/shutdown", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.getToken()}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stopping: true });
    expect(kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
  });
});
