/**
 * ACP transport (Agent Client Protocol).
 *
 * Kiro and the Copilot CLI expose no HTTP model API: each runs an ACP agent
 * over stdio (`kiro-cli acp`, `copilot --acp`). ACP has no system-prompt
 * field, so the system instruction is prepended to the user prompt.
 */

import { spawn } from "node:child_process";
import type { AiProvider } from "@mind/core";
import { JsonRpcPeer, type RpcMessage } from "./json-rpc.js";

export interface AcpAgent {
  command: string;
  args: string[];
}

export interface AcpOptions {
  agent: AcpAgent;
  cwd: string;
  prompt: string;
  system?: string;
  /** Skipped when the agent should pick its own (configured) model. */
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** The ACP command for a CLI provider, overridable for installs off PATH. */
export function acpAgent(provider: AiProvider): AcpAgent {
  if (provider === "kiro") {
    return {
      command: process.env["MIND_KIRO_BIN"] ?? "kiro-cli",
      args: ["acp"],
    };
  }
  if (provider === "copilot-cli") {
    return {
      command: process.env["MIND_COPILOT_BIN"] ?? "copilot",
      args: ["--acp"],
    };
  }
  throw new Error(`not an ACP provider: ${provider}`);
}

export async function acpPrompt(options: AcpOptions): Promise<string> {
  const child = spawn(options.agent.command, options.agent.args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const peer = new JsonRpcPeer(child.stdout, child.stdin);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    return await withTimeout(converse(peer, options), options);
  } catch (err) {
    const detail = stderr.trim();
    throw new Error(`${String(err)}${detail ? ` — ${detail}` : ""}`);
  } finally {
    peer.close();
    child.kill();
  }
}

async function converse(
  peer: JsonRpcPeer,
  options: AcpOptions,
): Promise<string> {
  await peer.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "mind", version: "1.0.0" },
  });

  const session = (await peer.request("session/new", {
    cwd: options.cwd,
    mcpServers: [],
  })) as { sessionId?: string };
  const sessionId = session.sessionId;
  if (!sessionId) throw new Error("ACP agent returned no session id");

  if (options.model) await selectModel(peer, sessionId, options.model);

  let text = "";
  peer.onMessage((message) => {
    text += chunkText(message);
  });

  const prompt = options.system
    ? `${options.system}\n\n${options.prompt}`
    : options.prompt;
  await peer.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: prompt }],
  });
  return text.trim();
}

/** Agents that do not support model switching simply keep their default. */
async function selectModel(
  peer: JsonRpcPeer,
  sessionId: string,
  model: string,
): Promise<void> {
  try {
    await peer.request("session/set_model", { sessionId, modelId: model });
  } catch {
    // Not every ACP agent implements session/set_model.
  }
}

interface SessionUpdate {
  update?: {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
  };
}

/** Streamed assistant text arrives as `session/update` notifications. */
function chunkText(message: RpcMessage): string {
  if (message.method !== "session/update") return "";
  const { update } = (message.params ?? {}) as SessionUpdate;
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  const content = update.content;
  return content?.type === "text" ? (content.text ?? "") : "";
}

function withTimeout<T>(promise: Promise<T>, options: AcpOptions): Promise<T> {
  const ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`ACP agent '${options.agent.command}' timed out after ${ms}ms`),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
