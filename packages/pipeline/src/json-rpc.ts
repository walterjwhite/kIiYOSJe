/**
 * Newline-delimited JSON-RPC 2.0 over an agent's stdio.
 *
 * ACP agents answer one JSON object per line. Banners and MOTD text are
 * ignored, so a chatty CLI cannot break the handshake.
 */

import type { Readable, Writable } from "node:stream";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class JsonRpcPeer {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners: ((message: RpcMessage) => void)[] = [];
  private buffer = "";
  private closed = false;

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.receive(chunk));
    input.on("end", () => this.failAll(new Error("ACP agent closed stdout")));
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("ACP connection is closed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.output.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  onMessage(listener: (message: RpcMessage) => void): void {
    this.listeners.push(listener);
  }

  close(): void {
    this.failAll(new Error("ACP client closed the connection"));
    if (this.closed) return;
    this.closed = true;
    this.output.end();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.dispatch(line.trim());
  }

  private dispatch(line: string): void {
    if (!line.startsWith("{")) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    for (const listener of this.listeners) listener(message);
    if (message.id === undefined || message.method) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "ACP request failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
