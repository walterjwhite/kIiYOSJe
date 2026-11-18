import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aiBaseUrl,
  aiConfigured,
  aiProvider,
  classifyModel,
  copilotIntegrationId,
  draftModel,
  isCliProvider,
  loadApiKey,
  writeAiConfig,
} from "./config.js";

// Keep ai.json out of the real home directory for this file's worker.
process.env["HOME"] = mkdtempSync(join(tmpdir(), "mind-ai-"));

const KEY_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GITHUB_COPILOT_TOKEN",
  "MIND_AI_API_KEY",
  "MIND_AI_PROVIDER",
  "MIND_AI_BASE_URL",
];

beforeEach(() => {
  writeAiConfig({});
  for (const name of KEY_VARS) delete process.env[name];
});

describe("providers", () => {
  it("defaults to ollama with no key required", () => {
    expect(aiProvider()).toBe("ollama");
    expect(aiConfigured()).toBe(true);
    expect(aiBaseUrl()).toBe("http://localhost:11434/v1");
    expect(classifyModel()).toBe("qwen2.5:3b-instruct");
    expect(isCliProvider()).toBe(false);
  });

  it("treats Kiro and Copilot CLI as ACP providers", () => {
    writeAiConfig({ provider: "kiro" });
    expect(isCliProvider()).toBe(true);
    expect(aiConfigured()).toBe(true);
    expect(classifyModel()).toBe("default");
    expect(() => aiBaseUrl()).toThrow(/baseURL/);

    writeAiConfig({ provider: "copilot-cli" });
    expect(isCliProvider()).toBe(true);
    expect(draftModel()).toBe("default");
  });

  it("needs a Copilot token but not a separate base URL", () => {
    writeAiConfig({ provider: "copilot" });
    expect(aiConfigured()).toBe(false);
    expect(aiBaseUrl()).toBe("https://api.githubcopilot.com");
    process.env["GITHUB_COPILOT_TOKEN"] = "ghu-test";
    expect(aiConfigured()).toBe(true);
    expect(loadApiKey()).toBe("ghu-test");
    expect(copilotIntegrationId()).toBe("copilot-developer-cli");
    process.env["MIND_COPILOT_INTEGRATION_ID"] = "custom";
    expect(copilotIntegrationId()).toBe("custom");
    delete process.env["MIND_COPILOT_INTEGRATION_ID"];
  });

  it("requires a base URL for openai-compatible", () => {
    writeAiConfig({ provider: "openai-compatible" });
    expect(aiConfigured()).toBe(false);
    writeAiConfig({
      provider: "openai-compatible",
      baseURL: "http://127.0.0.1:9000/v1",
      apiKey: "local",
    });
    expect(aiConfigured()).toBe(true);
    expect(aiBaseUrl()).toBe("http://127.0.0.1:9000/v1");
  });
});
