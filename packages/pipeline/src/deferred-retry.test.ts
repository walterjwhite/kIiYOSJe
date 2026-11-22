/**
 * A signal that arrives while the model is down is held and tried again, against a
 * stub provider that fails and then recovers.
 */

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Db,
  events,
  type NewSignal,
  openDb,
  signals,
  thoughts,
  writeAiConfig,
  writeResilienceSettings,
} from "@mind/core";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import { MAX_DEFER_ATTEMPTS } from "./deferral.js";
import { deferredCount, dueDeferrals, retryDeferred } from "./deferred-retry.js";
import { ensureFallbackDirection } from "./fallback-direction.js";
import { ingest } from "./ingest.js";
import { resetResilience } from "./resilience.js";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-deferred-"));
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-deferred-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-deferred-data-"));
delete process.env["OPENAI_API_KEY"];

const CLASSIFICATION = {
  confidence: 0.9,
  intent: "status request",
  signalKind: "question",
  urgency: "low",
  commitment: null,
  commitmentDueDate: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

let server: Server;
let requests = 0;
let script: number[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    request.on("data", () => {});
    request.on("end", () => {
      requests++;
      const status = script.shift() ?? 200;
      if (status !== 200) {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "stub failure" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: "stub",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(CLASSIFICATION) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  writeAiConfig({
    provider: "openai",
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: "sk-test",
    classifyModel: "stub-classify",
    draftModel: "stub-draft",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const settings = {
  timeoutSeconds: 30,
  retries: 0,
  retryDelayMs: 100,
  breakerFailures: 50,
  breakerResetSeconds: 60,
  maxConcurrent: 2,
};

let db: Db;
beforeEach(() => {
  writeResilienceSettings(settings);
  db = openDb(":memory:");
  ensureFallbackDirection(db);
});
afterEach(() => {
  requests = 0;
  script = [];
  resetResilience();
});

const incoming: NewSignal = {
  adapter: "test",
  externalId: "deferred-1",
  threadId: "t-1",
  sender: "alice@example.test",
  recipients: ["me@example.test"],
  kind: "email",
  subject: "Rollout",
  body: "Where are we on the rollout?",
  receivedAt: new Date("2026-03-02T09:00:00.000Z"),
  urgencyHint: null,
};

const minutesLater = (m: number) => new Date(Date.now() + m * 60_000);

function row(id: string) {
  return db.select().from(signals).where(eq(signals.id, id)).get();
}
function deferredEvents() {
  return db
    .select()
    .from(events)
    .where(eq(events.kind, "signal.deferred"))
    .all()
    .map((e) => JSON.parse(e.payload) as { signalId: string; attempt: number; reason: string });
}

describe("a signal that arrives while the model is down", () => {
  it("is stored, not absorbed, and not judged", async () => {
    script = [503];
    const result = await ingest(db, incoming, new AdapterRegistry());

    expect(result.disposition).toBe("new");
    expect(result.thoughtId).toBeNull();
    expect(result.actionId).toBeNull();
    const stored = row(result.signalId ?? "");
    expect(stored?.disposition).toBe("new");
    expect(stored?.body).toContain("rollout");
    expect(db.select().from(thoughts).all()).toHaveLength(0);
  });

  it("records why and when to try again, without the message", async () => {
    script = [503];
    const result = await ingest(db, incoming, new AdapterRegistry());
    const [event] = deferredEvents();
    expect(event?.signalId).toBe(result.signalId);
    expect(event?.attempt).toBe(1);
    expect(event?.reason).toBe("http_503");
    const raw = JSON.stringify(db.select().from(events).all());
    expect(raw).not.toContain("rollout");
    expect(raw).not.toContain("alice@example.test");
  });

  it("counts as waiting, and a repeat delivery is still a duplicate", async () => {
    script = [503];
    await ingest(db, incoming, new AdapterRegistry());
    expect(deferredCount(db)).toBe(1);
    const again = await ingest(db, incoming, new AdapterRegistry());
    expect(again.disposition).toBe("duplicate");
    expect(deferredCount(db)).toBe(1);
  });

  it("is retried once its time comes, and then judged like any other signal", async () => {
    script = [503];
    const first = await ingest(db, incoming, new AdapterRegistry());

    expect(dueDeferrals(db, new Date())).toHaveLength(0); // not due yet
    expect(dueDeferrals(db, minutesLater(2))).toHaveLength(1);

    const tried = await retryDeferred(db, new AdapterRegistry(), minutesLater(2));
    expect(tried).toBe(1);

    const done = row(first.signalId ?? "");
    expect(done?.disposition).not.toBe("new");
    expect(done?.signalKind).toBe("question");
    expect(deferredCount(db)).toBe(0);
    // One row, not two.
    expect(db.select().from(signals).all()).toHaveLength(1);
    const processed = db.select().from(events).where(eq(events.kind, "signal.processed")).all();
    expect(processed).toHaveLength(1);
  });

  it("is tried again later, with a longer wait, when the model is still down", async () => {
    script = [503, 503];
    const first = await ingest(db, incoming, new AdapterRegistry());
    await retryDeferred(db, new AdapterRegistry(), minutesLater(2));

    expect(row(first.signalId ?? "")?.disposition).toBe("new");
    const attempts = deferredEvents().map((e) => e.attempt);
    expect(attempts).toEqual(expect.arrayContaining([1, 2]));
    // After the second failure the next try is two minutes out, not one.
    expect(dueDeferrals(db, minutesLater(1.5))).toHaveLength(0);
    expect(dueDeferrals(db, minutesLater(3))).toHaveLength(1);
  });

  it("is handed to the operator, not left waiting, after the last try", async () => {
    script = Array(MAX_DEFER_ATTEMPTS + 2).fill(503);
    const first = await ingest(db, incoming, new AdapterRegistry());
    for (let i = 0; i < MAX_DEFER_ATTEMPTS + 1; i++) {
      await retryDeferred(db, new AdapterRegistry(), minutesLater(24 * 60 * (i + 1)));
    }
    const done = row(first.signalId ?? "");
    // Zero confidence is below every Direction's minimum, so it is escalated.
    expect(done?.disposition).toBe("escalated");
    expect(done?.thoughtId).not.toBeNull();
    expect(deferredCount(db)).toBe(0);
    const processed = db.select().from(events).where(eq(events.kind, "signal.processed")).all();
    expect(processed[0]?.payload).toContain("model unavailable after");
  });

  it("does not use up tries while the circuit is open", async () => {
    writeResilienceSettings({ ...settings, breakerFailures: 1 });
    script = [503, 503, 503];
    const first = await ingest(db, incoming, new AdapterRegistry()); // opens the breaker
    const before = requests;
    const tried = await retryDeferred(db, new AdapterRegistry(), minutesLater(2));
    expect(tried).toBe(0);
    expect(requests).toBe(before);
    expect(deferredEvents().filter((e) => e.signalId === first.signalId)).toHaveLength(1);
  });
});
