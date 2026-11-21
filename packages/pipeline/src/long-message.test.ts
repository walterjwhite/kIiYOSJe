/**
 * A message far larger than the model's window must still be classified and
 * drafted. The stub behaves like a small local Ollama: it refuses any request
 * over 4096 tokens with the same 400 error a real one returns.
 */

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions, directions, events, openDb, writeAiConfig, type NewSignal } from "@mind/core";
import { AdapterRegistry, ensureFallbackDirection, ingest } from "@mind/pipeline";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-long-message-"));
delete process.env["MIND_CONTEXT_TOKENS"];

const WINDOW_TOKENS = 4096;
const CLASSIFICATION = {
  confidence: 0.9,
  intent: "question",
  signalKind: "question",
  urgency: "low",
  commitment: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

let server: Server;
const seen = { accepted: 0, refused: 0, largest: 0 };

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw || "{}") as { response_format?: unknown; messages?: { content: string }[] };
      // A real tokenizer averages about 4 characters per token on English text.
      const tokens = Math.ceil((body.messages ?? []).reduce((n, m) => n + m.content.length, 0) / 4);
      seen.largest = Math.max(seen.largest, tokens);
      if (tokens > WINDOW_TOKENS) {
        seen.refused++;
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              code: 400,
              message: `request (${tokens} tokens) exceeds the available context size (${WINDOW_TOKENS} tokens), try increasing it`,
            },
          }),
        );
        return;
      }
      seen.accepted++;
      const content = body.response_format ? JSON.stringify(CLASSIFICATION) : "Yes, that works.";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: "stub",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: tokens, completion_tokens: 1, total_tokens: tokens + 1 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  writeAiConfig({ provider: "ollama", baseURL: `http://127.0.0.1:${port}/v1`, classifyModel: "stub", draftModel: "stub" });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("a message larger than the model's window", () => {
  it("is cut to fit, so classify and draft both succeed on the first try", async () => {
    const db = openDb(":memory:");
    ensureFallbackDirection(db);
    db.insert(directions)
      .values({
        id: "work/long",
        name: "long",
        scopeKind: "person",
        scopeValue: "newsletter@example.com",
        posture: "draft",
        standard: "Reply briefly.",
        autonomy: "draft",
        confidenceMin: 0.7,
        enabled: true,
        version: 1,
      })
      .run();

    // About 24k tokens: the size of the message that failed in real use.
    const signal: NewSignal = {
      adapter: "test",
      externalId: "long-1",
      threadId: "t-long",
      sender: "newsletter@example.com",
      recipients: ["me@example.com"],
      kind: "email",
      body: `Question up front: can you join on Friday?\n${"filler sentence about nothing in particular. ".repeat(2200)}\nPlease reply by Friday.`,
      receivedAt: new Date(),
      urgencyHint: null,
    };
    expect(signal.body.length / 4).toBeGreaterThan(20_000);

    await ingest(db, signal, new AdapterRegistry());

    expect(seen.refused).toBe(0);
    expect(seen.largest).toBeLessThanOrEqual(WINDOW_TOKENS);
    expect(db.select().from(actions).all()).toHaveLength(1);

    const processed = db.select().from(events).all().find((e) => e.kind === "signal.processed");
    const calls = (JSON.parse(processed!.payload) as { ai: { calls: { ok: boolean; omittedChars?: number }[] } }).ai.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c.ok)).toBe(true);
    expect(calls.every((c) => (c.omittedChars ?? 0) > 50_000)).toBe(true);
  });
});
