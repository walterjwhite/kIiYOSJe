/**
 * Model calls under a failing provider: a stub HTTP server answers with errors
 * and the real transport (AI SDK) plus the resilience policy handle them.
 */

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, writeAiConfig, writeResilienceSettings } from "@mind/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { classify } from "./classify.js";
import { ModelDeferral, resetResilience, resilienceState } from "./resilience.js";

process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-model-resilience-"));
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-model-resilience-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-model-resilience-data-"));
delete process.env["OPENAI_API_KEY"];

const CLASSIFICATION = {
  confidence: 0.9,
  intent: "status request",
  signalKind: "task",
  urgency: "high",
  commitment: null,
  commitmentDueDate: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

let server: Server;
let requests = 0;
/** Status codes to answer with, in order. Once empty the server answers 200. */
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

afterEach(() => {
  requests = 0;
  script = [];
  resetResilience();
});

const input = {
  signalBody: "Where are we on the rollout?",
  sender: "alice@example.test",
  standard: null,
  receivedAt: new Date("2026-03-02T09:00:00.000Z"),
};

const settings = {
  timeoutSeconds: 30,
  retries: 2,
  retryDelayMs: 100,
  breakerFailures: 3,
  breakerResetSeconds: 60,
  maxConcurrent: 2,
};

describe("classify through a failing provider", () => {
  it("retries a 503 and returns the real answer", async () => {
    writeResilienceSettings(settings);
    script = [503, 503];
    const out = await classify(input);
    expect(out.confidence).toBe(0.9);
    expect(requests).toBe(3);
  });

  it("does not stack the SDK's own retries on top of the policy's", async () => {
    writeResilienceSettings({ ...settings, retries: 0 });
    script = [503, 503, 503];
    // One request, then the signal is deferred: never an invented answer.
    await expect(classify(input)).rejects.toBeInstanceOf(ModelDeferral);
    expect(requests).toBe(1);
  });

  it("holds the signal for the operator, not for a retry, when the key is rejected", async () => {
    writeResilienceSettings(settings);
    script = [401];
    const out = await classify(input);
    // Asking again cannot fix a rejected key.
    expect(requests).toBe(1);
    expect(out.confidence).toBe(0);
  });

  it("stops calling a provider that keeps failing, and defers at once", async () => {
    writeResilienceSettings({ ...settings, retries: 0, breakerFailures: 2 });
    script = [500, 500, 500, 500];
    await expect(classify(input)).rejects.toBeInstanceOf(ModelDeferral);
    await expect(classify(input)).rejects.toBeInstanceOf(ModelDeferral);
    expect(resilienceState().circuit).toBe("open");

    const before = requests;
    await expect(classify(input)).rejects.toMatchObject({ reason: "circuit_open" });
    expect(requests).toBe(before);
  });

  it("logs the failure without the prompt, the sender, or the provider's reply", async () => {
    writeResilienceSettings({ ...settings, retries: 0 });
    script = [500];
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      await classify(input).catch(() => undefined);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("classify: model unavailable");
      expect(logged).toContain("500");
      expect(logged).not.toContain("rollout");
      expect(logged).not.toContain("alice@example.test");
      expect(logged).not.toContain("stub failure");
    } finally {
      warn.mockRestore();
    }
  });
});
