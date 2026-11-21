/**
 * End-to-end model path: config → AI SDK → stub HTTP server → classify/draft
 * → ingest, proving the wires are connected, not the model's quality.
 */

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions, directions, openDb, writeAiConfig, type NewSignal } from "@mind/core";
import { AdapterRegistry, ensureFallbackDirection, ingest } from "@mind/pipeline";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-model-call-"));
delete process.env["OPENAI_API_KEY"];

const CLASSIFICATION = {
  confidence: 0.9,
  intent: "status request",
  signalKind: "task",
  urgency: "high",
  commitment: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

interface Call {
  auth: string;
  model?: string;
  structured: boolean;
}

const calls: Call[] = [];
let server: Server;

function signal(id: string): NewSignal {
  return {
    adapter: "test",
    externalId: `status-${id}`,
    threadId: `t-${id}`,
    sender: "alice@example.com",
    recipients: ["me@example.com"],
    kind: "email",
    body: "Status request: where are we on the rollout?",
    receivedAt: new Date(),
    urgencyHint: null,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        model?: string;
        response_format?: unknown;
      };
      calls.push({
        auth: String(request.headers.authorization ?? ""),
        ...(body.model ? { model: body.model } : {}),
        structured: body.response_format !== undefined,
      });
      const content = body.response_format
        ? JSON.stringify(CLASSIFICATION)
        : "The numbers land today.";
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
              message: { role: "assistant", content },
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

describe("model call path", () => {
  it("proposes drafts from the configured classifier and drafter", async () => {
    const db = openDb(":memory:");
    ensureFallbackDirection(db);
    db.insert(directions)
      .values({
        id: "work/status",
        name: "status",
        scopeKind: "person",
        scopeValue: "alice@example.com",
        posture: "draft",
        standard: "Reply with the numbers.",
        autonomy: "draft",
        confidenceMin: 0.7,
        responsePrompt: "Lead with the current state.",
        enabled: true,
        version: 1,
      })
      .run();

    for (const id of ["1", "2"]) {
      await ingest(db, signal(id), new AdapterRegistry());
    }

    const rows = db.select().from(actions).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "proposed")).toBe(true);
  });

  it("authenticates with the configured key and model names", () => {
    const classify = calls.filter((call) => call.structured);
    const draft = calls.filter((call) => !call.structured);

    expect(classify).toHaveLength(2);
    expect(classify[0]?.auth).toBe("Bearer sk-test");
    expect(classify[0]?.model).toBe("stub-classify");
    expect(draft[0]?.model).toBe("stub-draft");
  });
});
