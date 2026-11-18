/**
 * Typed HTTP client for the mind server.
 * Used by all tree providers and webviews.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function serverUrl(): string {
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

  return res.json() as Promise<T>;
}
