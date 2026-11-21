import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { directions, signals } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-flow-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-flow-data-"));

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "migrations");
const DAY = 86_400_000;

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(directions)
    .values({
      id: "work/boss", name: "boss", scopeKind: "person", scopeValue: "boss@example.com", posture: "draft",
      standard: "x", autonomy: "draft", confidenceMin: 0.5, enabled: true, version: 1,
    })
    .run();
  const app = buildApp(db, new AdapterRegistry());
  const call = (path: string) =>
    app.request(path, { headers: { Authorization: `Bearer ${auth.getToken()}` } });
  let n = 0;
  const add = (over: Partial<typeof signals.$inferInsert>) => {
    const id = `s${++n}`;
    db.insert(signals)
      .values({
        id, adapter: "gmail", externalId: id, sender: "a@example.com", recipients: "[]", kind: "email", body: "hi",
        receivedAt: new Date(Date.now() - DAY).toISOString(), disposition: "absorbed", dedupeKey: id, ...over,
      })
      .run();
    return id;
  };
  return { call, add };
}

describe("GET /metrics/flow", () => {
  it("counts signals per channel, direction and outcome, inside the window only", async () => {
    const { call, add } = setup();
    add({ directionId: "work/boss", disposition: "absorbed" });
    add({ directionId: "work/boss", disposition: "absorbed" });
    add({ directionId: "work/boss", disposition: "promoted" });
    add({ adapter: "outlook", directionId: null, disposition: "filed" });
    add({ directionId: "work/boss", disposition: "absorbed", receivedAt: new Date(Date.now() - 30 * DAY).toISOString() });

    const body = (await (await call("/metrics/flow?window=7d")).json()) as {
      links: { adapter: string; directionId: string | null; directionName: string | null; disposition: string; count: number }[];
    };
    const find = (adapter: string, disposition: string) => body.links.find((l) => l.adapter === adapter && l.disposition === disposition);
    expect(find("gmail", "absorbed")).toMatchObject({ directionId: "work/boss", directionName: "boss", count: 2 });
    expect(find("gmail", "promoted")?.count).toBe(1);
    expect(find("outlook", "filed")).toMatchObject({ directionId: null, directionName: null, count: 1 });
    expect(body.links.reduce((n, l) => n + l.count, 0)).toBe(4);
  });
});

describe("GET /metrics/signals drill-down", () => {
  it("filters by outcome and window, and still refuses an unfiltered request", async () => {
    const { call, add } = setup();
    const recent = add({ directionId: "work/boss", disposition: "promoted" });
    add({ directionId: "work/boss", disposition: "absorbed" });
    add({ directionId: "work/boss", disposition: "promoted", receivedAt: new Date(Date.now() - 30 * DAY).toISOString() });

    const rows = (await (await call("/metrics/signals?disposition=promoted&window=7d")).json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([recent]);

    const both = (await (await call("/metrics/signals?directionId=work/boss&disposition=promoted")).json()) as unknown[];
    expect(both).toHaveLength(2);

    expect((await call("/metrics/signals?window=7d")).status).toBe(400);
  });
});
