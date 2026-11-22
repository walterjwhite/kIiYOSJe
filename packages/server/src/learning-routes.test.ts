import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-lr-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-lr-data-"));
process.env["MIND_AI_PROVIDER"] = "openai";
delete process.env["OPENAI_API_KEY"];
delete process.env["MIND_AI_API_KEY"];

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);

function appAndDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, app: buildApp(db, new AdapterRegistry()) };
}

function appWithDb() {
  return appAndDb().app;
}

const headers = () => ({ Authorization: `Bearer ${auth.getToken()}` });

describe("/admin/learning (nightly window)", () => {
  it("defaults to 00:00 to 04:00, and saves a new window", async () => {
    const app = appWithDb();
    const first = await app.request("/admin/learning", { headers: headers() });
    expect(await first.json()).toEqual({
      windowStart: "00:00",
      windowEnd: "04:00",
      idleEnabled: true,
      idleMinutes: 10,
      minNewDecisions: 5,
      minGapMinutes: 60,
    });

    const put = await app.request("/admin/learning", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ windowStart: "01:00", windowEnd: "05:30" }),
    });
    expect(put.status).toBe(200);
    const again = await app.request("/admin/learning", { headers: headers() });
    expect(await again.json()).toMatchObject({ windowStart: "01:00", windowEnd: "05:30" });
  });

  it("saves the idle trigger settings and rejects out-of-range values", async () => {
    const app = appWithDb();
    const put = (body: unknown) =>
      app.request("/admin/learning", {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const window = { windowStart: "00:00", windowEnd: "04:00" };
    expect(
      (
        await put({
          ...window,
          idleEnabled: false,
          idleMinutes: 20,
          minNewDecisions: 8,
          minGapMinutes: 120,
        })
      ).status,
    ).toBe(200);
    const saved = await app.request("/admin/learning", { headers: headers() });
    expect(await saved.json()).toMatchObject({
      idleEnabled: false,
      idleMinutes: 20,
      minNewDecisions: 8,
      minGapMinutes: 120,
    });
    expect((await put({ ...window, idleMinutes: 0 })).status).toBe(400);
  });

  it("rejects a malformed time", async () => {
    const res = await appWithDb().request("/admin/learning", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ windowStart: "25:00", windowEnd: "04:00" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("/proposals/schedule", () => {
  it("reports the window and, after a manual run, the last run", async () => {
    const app = appWithDb();
    const before = (await (
      await app.request("/proposals/schedule", { headers: headers() })
    ).json()) as { lastRun: unknown; running: boolean };
    expect(before.lastRun).toBeNull();
    expect(before.running).toBe(false);

    const run = await app.request("/proposals/run", { method: "POST", headers: headers() });
    expect(run.status).toBe(200);
    const after = (await (
      await app.request("/proposals/schedule", { headers: headers() })
    ).json()) as {
      lastRun: { trigger: string; durationMs?: number } | null;
      lastScheduledRun: unknown;
      running: boolean;
    };
    expect(after.lastRun?.trigger).toBe("manual");
    expect(after.lastRun?.durationMs).toBeGreaterThanOrEqual(0);
    expect(after.running).toBe(false);
    expect(after.lastScheduledRun).toBeNull();
  });
});

describe("/proposals/run while running", () => {
  it("reports running and refuses a second run", async () => {
    const app = appWithDb();
    const first = app.request("/proposals/run", { method: "POST", headers: headers() });
    const second = app.request("/proposals/run", { method: "POST", headers: headers() });
    const statusRes = app.request("/proposals/schedule", { headers: headers() });
    const status = (await (await statusRes).json()) as { running: boolean };
    expect(status.running).toBe(true);
    expect((await second).status).toBe(409);
    expect((await first).status).toBe(200);
  });
});

describe("accepting a proposal for a new Direction", () => {
  it("lists the hand edit on the accepted proposal", async () => {
    const { db, app } = appAndDb();
    db.insert(schema.events)
      .values({
        id: "p1",
        actor: "system",
        kind: "direction.proposal",
        payload: JSON.stringify({
          kind: "new",
          directionId: null,
          field: "scope",
          currentValue: null,
          proposedValue: "alex@example.test",
          rationale: "synthetic",
          evidence: { total: 4, discarded: 0, sent: 0, overrideRate: 0 },
        }),
      })
      .run();
    const accept = await app.request("/proposals/p1/accept", {
      method: "POST",
      headers: headers(),
    });
    expect(accept.status).toBe(200);
    const list = (await (await app.request("/proposals", { headers: headers() })).json()) as {
      status: string;
      yamlChange: string | null;
    }[];
    expect(list[0]?.status).toBe("accepted");
    expect(list[0]?.yamlChange).toContain("alex@example.test");
  });
});

describe("/learnings", () => {
  it("requires the token", async () => {
    expect((await appWithDb().request("/learnings")).status).toBe(401);
  });

  it("lists learnings and the files that were skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-lr-learnings-"));
    process.env["MIND_LEARNINGS_DIR"] = dir;
    try {
      writeFileSync(join(dir, "tone.md"), "---\ntitle: Tone\n---\nKeep it short.");
      writeFileSync(join(dir, "broken.md"), "---\napplies: nope\n---\nx");
      const res = await appWithDb().request("/learnings", { headers: headers() });
      const body = (await res.json()) as {
        learnings: { id: string; title: string }[];
        problems: { id: string }[];
      };
      expect(body.learnings.map((l) => l.title)).toEqual(["Tone"]);
      expect(body.problems.map((p) => p.id)).toEqual(["broken"]);
    } finally {
      delete process.env["MIND_LEARNINGS_DIR"];
    }
  });
});
