import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acpPrompt } from "./acp.js";

// A fake agent that, before answering the prompt, asks the client for permission to
// run a tool and for a file read. A client that ignores those requests leaves the
// agent waiting; a client that grants them lets the agent act on the operator's machine.
const AGENT_SOURCE = `
const fs = require("node:fs");
let buffer = "";
let promptId = null;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) if (line.trim()) handle(JSON.parse(line));
});
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
function log(message) { fs.appendFileSync(process.env.ACP_LOG, JSON.stringify(message) + "\\n"); }
function handle(message) {
  log(message);
  if (message.method === "initialize") {
    return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
  }
  if (message.method === "session/new") {
    return send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
  }
  if (message.method === "session/prompt") {
    promptId = message.id;
    send({ jsonrpc: "2.0", id: 900, method: "session/request_permission",
      params: { sessionId: "s1", toolCall: { toolCallId: "t1" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }] } });
    return send({ jsonrpc: "2.0", id: 901, method: "fs/read_text_file",
      params: { sessionId: "s1", path: "/etc/passwd" } });
  }
  // A reply to one of the agent's own requests.
  if (message.id === 901) {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } } });
    send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
  }
}
`;

const dir = mkdtempSync(join(tmpdir(), "mind-acp-requests-"));
const fixture = join(dir, "agent.cjs");
const log = join(dir, "log.jsonl");

interface Logged {
  id?: number;
  result?: { outcome?: { outcome?: string; optionId?: string } };
  error?: { code?: number };
}

describe("acpPrompt: requests from the agent", () => {
  it("refuses a permission request and a file read, and the prompt still completes", async () => {
    writeFileSync(fixture, AGENT_SOURCE);
    process.env["ACP_LOG"] = log;

    const text = await acpPrompt({
      agent: { command: process.execPath, args: [fixture] },
      cwd: process.cwd(),
      prompt: "hi",
      timeoutMs: 10_000,
    });
    expect(text).toBe("done");

    const replies = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Logged);
    const permission = replies.find((m) => m.id === 900);
    const fileRead = replies.find((m) => m.id === 901);

    // Cancelled, never selected: the agent gets no permission to act.
    expect(permission?.result?.outcome?.outcome).toBe("cancelled");
    expect(permission?.result?.outcome?.optionId).toBeUndefined();
    // The client advertised no file access, so a read is an error.
    expect(fileRead?.error?.code).toBe(-32601);
  });
});
