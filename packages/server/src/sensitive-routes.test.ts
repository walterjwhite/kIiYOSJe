import { mkdtempSync } from "node:fs";
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
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-sens-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-sens-data-"));

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);

function appWithDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return buildApp(db, new AdapterRegistry());
}

const headers = () => ({
  Authorization: `Bearer ${auth.getToken()}`,
  "Content-Type": "application/json",
});

describe("/admin/sensitive", () => {
  it("requires the token", async () => {
    expect((await appWithDb().request("/admin/sensitive")).status).toBe(401);
  });

  it("returns the default topics, then the saved list", async () => {
    const app = appWithDb();
    const first = (await (
      await app.request("/admin/sensitive", { headers: headers() })
    ).json()) as {
      topics: { name: string }[];
    };
    expect(first.topics.map((t) => t.name)).toEqual(["legal", "financial", "health"]);

    const put = await app.request("/admin/sensitive", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        topics: [{ name: "immigration", keywords: ["visa", "green card"], enabled: true }],
      }),
    });
    expect(put.status).toBe(200);
    const again = (await (
      await app.request("/admin/sensitive", { headers: headers() })
    ).json()) as {
      topics: { name: string }[];
    };
    expect(again.topics.map((t) => t.name)).toEqual(["immigration"]);
  });

  it("rejects a topic with no keywords", async () => {
    const res = await appWithDb().request("/admin/sensitive", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ topics: [{ name: "x", keywords: [], enabled: true }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("/admin/resilience", () => {
  it("requires the token", async () => {
    expect((await appWithDb().request("/admin/resilience")).status).toBe(401);
  });

  it("returns the defaults, saves a change, and rejects an out-of-range value", async () => {
    const app = appWithDb();
    const first = (await (
      await app.request("/admin/resilience", { headers: headers() })
    ).json()) as { retries: number; maxConcurrent: number };
    expect(first.retries).toBe(2);
    expect(first.maxConcurrent).toBe(2);

    const put = (body: unknown) =>
      app.request("/admin/resilience", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(body),
      });
    expect((await put({ retries: 4, maxConcurrent: 1 })).status).toBe(200);
    const again = (await (
      await app.request("/admin/resilience", { headers: headers() })
    ).json()) as { retries: number; maxConcurrent: number; timeoutSeconds: number };
    expect(again.retries).toBe(4);
    expect(again.maxConcurrent).toBe(1);
    expect(again.timeoutSeconds).toBe(120);

    expect((await put({ maxConcurrent: 50 })).status).toBe(400);
  });
});
