import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { signals, thoughts } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";
import * as auth from "./auth.js";
import { summaryRouter } from "./routes/summary.js";
import { nodePiperIo } from "./piper-io.js";
import type { PiperIo } from "./piper.js";

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-summary-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-summary-data-"));

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);

function openDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

/** Real filesystem in the temp dirs; only the process and the network are faked. */
function fakeIo(over: Partial<PiperIo> = {}): PiperIo {
  return {
    ...nodePiperIo,
    download: async (_url, dest) => writeFileSync(dest, "voice"),
    run: async (_file, args, stdin) => {
      writeFileSync(args[args.indexOf("-f") + 1]!, `RIFF:${stdin.length}`);
      return { code: 0, stderr: "" };
    },
    ...over,
  };
}

function appWith(io: PiperIo) {
  const db = openDb();
  const app = new Hono();
  app.route(
    "/summary",
    summaryRouter(db, io, () => new Date("2026-11-20T09:00:00")),
  );
  return { db, request: (path: string, init?: RequestInit) => app.request(path, init) };
}

describe("/summary", () => {
  it("builds the transcript from goals and the queue", async () => {
    const { db, request } = appWith(fakeIo());
    db.insert(thoughts)
      .values({ id: "g1", title: "Ship the report", body: "", state: "goal" })
      .run();
    db.insert(signals)
      .values({
        id: "s1",
        adapter: "gmail",
        externalId: "s1",
        sender: "boss@example.com",
        recipients: "[]",
        kind: "email",
        body: "need numbers",
        receivedAt: new Date().toISOString(),
        disposition: "promoted",
        dedupeKey: "s1",
        thoughtId: "g1",
      })
      .run();

    const res = await request("/summary");
    const body = (await res.json()) as { text: string; audio: unknown };
    expect(body.text).toContain("Ship the report: 1 item linked");
    expect(body.audio).toBeNull();
  });

  it("renders audio, serves it, and marks it stale once the transcript changes", async () => {
    const { db, request } = appWith(fakeIo());
    const render = await request("/summary/audio", { method: "POST" });
    expect(render.status).toBe(200);

    const audio = await request("/summary/audio");
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect((await audio.text()).startsWith("RIFF")).toBe(true);

    let meta = (await (await request("/summary")).json()) as { audio: { stale: boolean } };
    expect(meta.audio.stale).toBe(false);

    db.insert(thoughts).values({ id: "g2", title: "New goal", body: "", state: "goal" }).run();
    meta = (await (await request("/summary")).json()) as { audio: { stale: boolean } };
    expect(meta.audio.stale).toBe(true);
  });

  it("answers 503 with a stable code when Piper is not installed", async () => {
    const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    const { request } = appWith(fakeIo({ run: async () => Promise.reject(missing) }));
    const res = await request("/summary/audio", { method: "POST" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("piper_not_found");
  });
});

describe("/admin/audio", () => {
  const call = (app: ReturnType<typeof buildApp>, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${auth.getToken()}`, "Content-Type": "application/json" },
    });

  it("round-trips settings and rejects a voice name that could escape the voice folder", async () => {
    const app = buildApp(openDb(), new AdapterRegistry());
    const good = {
      voice: "en_GB-alba-medium",
      speaker: null,
      speed: 1.25,
      tone: "calm",
      piperCommand: "piper",
      autoDownload: true,
    };
    expect(
      (await call(app, "/admin/audio", { method: "PUT", body: JSON.stringify(good) })).status,
    ).toBe(200);
    expect(await (await call(app, "/admin/audio")).json()).toEqual(good);

    const bad = { ...good, voice: "../../etc/passwd" };
    expect(
      (await call(app, "/admin/audio", { method: "PUT", body: JSON.stringify(bad) })).status,
    ).toBe(400);
    expect(((await (await call(app, "/admin/audio")).json()) as { voice: string }).voice).toBe(
      "en_GB-alba-medium",
    );
  });
});
