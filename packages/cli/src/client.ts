/** Minimal HTTP client for the local API; every command shares this. */

import { readFileSync } from "node:fs";
import { SERVER_HOST, SERVER_PORT, tokenPath } from "@mind/core";

export async function api(path: string, method = "GET", body?: unknown): Promise<unknown> {
  let token: string;
  try {
    token = readFileSync(tokenPath(), "utf8").trim();
  } catch {
    throw new Error("No API token found. Run `mind start` first to generate one.");
  }

  const res = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
