/**
 * Typed HTTP client for the mind server.
 * Used by all tree providers and webviews.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { statusIndicator } from "./status-indicator.js";

export function serverUrl(): string {
  return (
    vscode.workspace.getConfiguration("mind").get<string>("serverUrl") ?? "http://127.0.0.1:8787"
  );
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The address to put in a pairing QR code: one the phone can reach, which is not
 * necessarily the one this extension uses. `mind.serverUrl` is normally
 * loopback, and a phone only gets there over USB (adb reverse), so the default
 * here is this machine's private network address. Setting
 * `mind.pairingServerUrl` overrides it, for example to `http://127.0.0.1:8787`
 * when deploying with `android/deploy-debug.sh --local`.
 */
export function pairingServerUrl(): string {
  const configured =
    vscode.workspace.getConfiguration("mind").get<string>("pairingServerUrl") ?? "";
  if (configured.trim()) return configured.trim().replace(/\/+$/, "");

  const local = serverUrl();
  let parsed: URL;
  try {
    parsed = new URL(local);
  } catch {
    return local;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return local;

  const address = localAddress();
  if (!address) return local;
  return `${parsed.protocol}//${address}:${parsed.port || "8787"}`;
}

/** This machine's private IPv4 address, if it has one. */
function localAddress(): string | undefined {
  const candidates: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push(entry.address);
    }
  }
  return candidates.find((address) => isPrivate(address)) ?? candidates[0];
}

function isPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && (second ?? 0) >= 16 && (second ?? 0) <= 31) ||
    (first === 192 && second === 168)
  );
}

function tokenPath(): string {
  const configured = vscode.workspace.getConfiguration("mind").get<string>("tokenPath");
  if (configured) return configured;
  const configDir = process.env["MIND_CONFIG_DIR"];
  return configDir
    ? path.join(configDir, "token")
    : path.join(os.homedir(), ".config", "kIiYOSJe", "mind", "token");
}

/** The token, or undefined if the server has never run. */
export function readToken(): string | undefined {
  try {
    return getToken();
  } catch {
    return undefined;
  }
}

function getToken(): string {
  try {
    return fs.readFileSync(tokenPath(), "utf8").trim();
  } catch {
    throw new Error(
      "mind: could not read API token. Is the server running? Check ~/.config/kIiYOSJe/mind/token",
    );
  }
}

export async function apiFetch<T>(urlPath: string, options: RequestInit = {}): Promise<T> {
  statusIndicator.begin();
  try {
    const url = `${serverUrl()}${urlPath}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`mind API ${res.status} ${urlPath}: ${text}`);
    }

    const result = (await res.json()) as T;
    statusIndicator.end(true);
    return result;
  } catch (err) {
    statusIndicator.end(false);
    throw err;
  }
}

/** Fetches a binary response (the rendered summary audio). Bounded by a timeout. */
export async function apiFetchBytes(urlPath: string, timeoutMs = 60_000): Promise<Buffer> {
  statusIndicator.begin();
  try {
    const res = await fetch(`${serverUrl()}${urlPath}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`mind API ${res.status} ${urlPath}: ${await res.text()}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    statusIndicator.end(true);
    return bytes;
  } catch (err) {
    statusIndicator.end(false);
    throw err;
  }
}
