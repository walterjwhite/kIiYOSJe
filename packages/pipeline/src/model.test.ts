import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClassifierOutputSchema, writeAiConfig } from "@mind/core";
import { generateReply, generateStructured, type ModelTrace } from "./model.js";

process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-transport-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-transport-data-"));

const CLASSIFICATION = {
  confidence: 0.83,
  intent: "status request",
  signalKind: "task",
  urgency: "high",
  commitment: null,
  escalateBy: "2026-12-01T17:00:00.000Z",
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
        : "  The numbers land today.  ";
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

describe("model transport", () => {
  it("returns trimmed reply text from the drafter", async () => {
    expect(await generateReply({ system: "sys", prompt: "prompt" })).toBe(
      "The numbers land today.",
    );
  });

  it("returns a schema-validated classification", async () => {
    const object = await generateStructured(ClassifierOutputSchema, {
      system: "sys",
      prompt: "prompt",
    });
    expect(object.confidence).toBe(0.83);
    expect(object.signalKind).toBe("task");
  });

  it("sends the configured key, model names and a structured-output request", () => {
    expect(calls).toHaveLength(2);
    const classify = calls.find((call) => call.structured);
    const draft = calls.find((call) => !call.structured);
    expect(classify?.model).toBe("stub-classify");
    expect(classify?.auth).toBe("Bearer sk-test");
    expect(draft?.model).toBe("stub-draft");
  });

  it("reports a trace with provider, model, endpoint, timing and no message text", async () => {
    const traces: ModelTrace[] = [];
    await generateReply({
      system: "sys",
      prompt: "secret-message-body",
      operation: "transform",
      onTrace: (t) => traces.push(t),
    });

    expect(traces).toHaveLength(1);
    const t = traces[0]!;
    expect(t).toMatchObject({
      operation: "transform",
      provider: "openai",
      model: "stub-draft",
      transport: "http",
      ok: true,
      promptChars: "sys".length + "secret-message-body".length,
    });
    expect(t.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(t.durationMs).toBeGreaterThanOrEqual(0);
    expect(t.inputTokens).toBe(1);
    expect(t.outputTokens).toBe(1);
    expect(JSON.stringify(t)).not.toContain("secret-message-body");
  });
});
