import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acpAgent, acpPrompt } from "./acp.js";

const AGENT_SOURCE = `
const fs = require("node:fs");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) if (line.trim()) handle(JSON.parse(line));
});
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
function handle(request) {
  fs.appendFileSync(process.env.ACP_LOG, JSON.stringify(request) + "\\n");
  if (request.method === "initialize") {
    return send({ jsonrpc: "2.0", id: request.id,
      result: { protocolVersion: 1, agentInfo: { name: "fake" } } });
  }
  if (request.method === "session/new") {
    return send({ jsonrpc: "2.0", id: request.id, result: { sessionId: "sess-1" } });
  }
  if (request.method === "session/prompt") {
    for (const text of ["Hello ", "world"]) {
      send({ jsonrpc: "2.0", method: "session/update", params: {
        sessionId: "sess-1",
        update: { sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text } },
      } });
    }
    return send({ jsonrpc: "2.0", id: request.id,
      result: { stopReason: "end_turn" } });
  }
  send({ jsonrpc: "2.0", id: request.id, result: {} });
}
`;

const dir = mkdtempSync(join(tmpdir(), "mind-acp-"));
const fixture = join(dir, "agent.cjs");
const log = join(dir, "requests.jsonl");

interface JsonRpcRequest {
  method: string;
  params?: {
    cwd?: string;
    prompt?: { type: string; text: string }[];
  };
}

function requests(): JsonRpcRequest[] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRpcRequest);
}

describe("acpPrompt", () => {
  it("runs the handshake, prompt and streamed reply", async () => {
    writeFileSync(fixture, AGENT_SOURCE);
    process.env["ACP_LOG"] = log;

    const text = await acpPrompt({
      agent: { command: process.execPath, args: [fixture] },
      cwd: process.cwd(),
      system: "SYS",
      prompt: "PROMPT",
      timeoutMs: 10_000,
    });

    expect(text).toBe("Hello world");
  });

  it("creates the session in the given cwd and prepends the system text", () => {
    const calls = requests();
    expect(calls.map((request) => request.method)).toEqual([
      "initialize",
      "session/new",
      "session/prompt",
    ]);
    expect(calls[1]?.params?.cwd).toBe(process.cwd());
    expect(calls[2]?.params?.prompt?.[0]?.text).toMatch(/^SYS\n\nPROMPT$/);
  });
});

describe("acpAgent", () => {
  it("maps providers to their ACP commands", () => {
    delete process.env["MIND_KIRO_BIN"];
    delete process.env["MIND_COPILOT_BIN"];
    expect(acpAgent("kiro")).toEqual({ command: "kiro-cli", args: ["acp"] });
    expect(acpAgent("copilot-cli")).toEqual({
      command: "copilot",
      args: ["--acp"],
    });
  });

  it("honours binary overrides for installs off PATH", () => {
    process.env["MIND_KIRO_BIN"] = "/opt/kiro";
    expect(acpAgent("kiro")).toEqual({ command: "/opt/kiro", args: ["acp"] });
    delete process.env["MIND_KIRO_BIN"];
  });
});
