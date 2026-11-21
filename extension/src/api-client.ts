/**
 * Typed HTTP client for the mind server.
 * Used by all tree providers and webviews.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { statusIndicator } from "./status-indicator.js";

export function serverUrl(): string {
  return (
    vscode.workspace
      .getConfiguration("mind")
      .get<string>("serverUrl") ?? "http://127.0.0.1:8787"
  );
}

function tokenPath(): string {
  const configured = vscode.workspace
    .getConfiguration("mind")
    .get<string>("tokenPath");
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

export async function apiFetch<T>(
  urlPath: string,
  options: RequestInit = {},
): Promise<T> {
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
