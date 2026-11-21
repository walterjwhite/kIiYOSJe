/**
 * The real I/O behind piper.ts: child process, filesystem, and fetch.
 * Kept apart so piper.ts can be tested with a fake.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PiperIo, RunResult } from "./piper.js";

const STDERR_LIMIT = 4000;

function run(file: string, args: readonly string[], stdin: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // No shell: the command and its arguments are passed as an argv array.
    const child = spawn(file, [...args], { stdio: ["pipe", "ignore", "pipe"], shell: false });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
    child.stdin.on("error", () => {
      /* Piper may exit before reading everything; the exit code reports that. */
    });
    child.stdin.end(text(stdin));
  });
}

const text = (s: string): Buffer => Buffer.from(s, "utf8");

async function download(url: string, dest: string, maxBytes: number, timeoutMs: number): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("file is larger than the allowed size");

  let seen = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > maxBytes) done(new Error("file is larger than the allowed size"));
      else done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), limit, createWriteStream(dest, { mode: 0o600 }), {
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export const nodePiperIo: PiperIo = {
  exists: (p) => existsSync(p),
  mkdirp: (p) => void mkdirSync(p, { recursive: true, mode: 0o700 }),
  rename: (a, b) => renameSync(a, b),
  remove: (p) => rmSync(p, { force: true }),
  run,
  download,
};
