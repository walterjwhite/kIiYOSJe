import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@mind/core";
import { directions, actions, events, signals } from "@mind/core";
import type { Adapter, NewSignal } from "@mind/core";

vi.mock("./classify.js", () => ({
  classify: async () => ({
    confidence: 0.95,
    intent: "ask",
    signalKind: "question",
    urgency: "low",
    commitment: null,
    escalateBy: null,
    sensitiveTopics: [],
    answerable: true,
    answerBlocker: null,
  }),
}));
let draftText: string | null = "Here is the answer.";
vi.mock("./draft.js", () => ({ draft: async () => draftText }));

import { ingest } from "./ingest.js";
import { AdapterRegistry } from "./adapter-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function setup(autonomy: string) {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(directions)
    .values({
      id: "d1",
      name: "d1",
      scopeKind: "person",
      scopeValue: "a@x.com",
      posture: "absorb",
      standard: "s",
      autonomy,
      confidenceMin: 0.5,
      enabled: true,
      version: 1,
    })
    .run();
  const send = vi.fn(async () => ({ externalId: "ext-1" }));
  const adapter: Adapter = {
    id: "t",
    capabilities: { canSend: true, canStream: false },
    start: async () => {},
    stop: async () => {},
    send,
  };
  const reg = new AdapterRegistry();
  reg.register(adapter);
  return { db, reg, send };
}

let n = 0;
const sig = (): NewSignal => ({
  adapter: "t",
  externalId: `e${++n}`,
  threadId: null,
  sender: "a@x.com",
  recipients: ["me@x.com"],
  kind: "m",
  body: "q?",
  receivedAt: new Date(),
  urgencyHint: null,
});

const savedHome = process.env["HOME"];
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mind-home-"));
  process.env["HOME"] = home; // isolates the paused flag file
  process.env["MIND_SEND_ENABLED"] = "true";
  draftText = "Here is the answer.";
});
afterEach(() => {
  process.env["HOME"] = savedHome;
  delete process.env["MIND_SEND_ENABLED"];
});

describe("autonomous send", () => {
  it("sends when every gate is open and records an autonomous event", async () => {
    const { db, reg, send } = setup("send");
    await ingest(db, sig(), reg);
    expect(send).toHaveBeenCalledOnce();
    expect(db.select().from(actions).all()[0]?.status).toBe("sent");
    const ev = db
      .select()
      .from(events)
      .all()
      .find((e) => e.kind === "action.sent");
    expect(JSON.parse(ev!.payload).autonomous).toBe(true);
  });

  it("does not send when autonomy is draft", async () => {
    const { db, reg, send } = setup("draft");
    await ingest(db, sig(), reg);
    expect(send).not.toHaveBeenCalled();
    expect(db.select().from(actions).all()[0]?.status).toBe("proposed");
  });

  it("does not send when the kill switch file exists", async () => {
    mkdirSync(join(home, ".config", "kIiYOSJe", "mind"), { recursive: true });
    writeFileSync(join(home, ".config", "kIiYOSJe", "mind", "paused"), "");
    const { db, reg, send } = setup("send");
    await ingest(db, sig(), reg);
    expect(send).not.toHaveBeenCalled();
    expect(db.select().from(actions).all()[0]?.status).toBe("proposed");
  });

  it("does not send when MIND_SEND_ENABLED is unset", async () => {
    delete process.env["MIND_SEND_ENABLED"];
    const { db, reg, send } = setup("send");
    await ingest(db, sig(), reg);
    expect(send).not.toHaveBeenCalled();
  });

  it("files the signal instead of sending when the draft is empty", async () => {
    draftText = "";
    const { db, reg, send } = setup("send");
    await ingest(db, sig(), reg);
    expect(send).not.toHaveBeenCalled();
    expect(db.select().from(actions).all()).toHaveLength(0);
    expect(db.select().from(signals).all()[0]?.disposition).toBe("filed");
  });
});
