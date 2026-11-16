#!/usr/bin/env node
/**
 * mind CLI — commands: start | pause | observe | metrics
 */

import { readFileSync } from "node:fs";
import { tokenPath, SERVER_HOST, SERVER_PORT } from "@mind/core";

const [, , command, ...args] = process.argv;

async function apiCall(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  let token: string;
  try {
    token = readFileSync(tokenPath(), "utf8").trim();
  } catch {
    console.error(
      "No API token found. Run `mind start` first to generate one.",
    );
    process.exit(1);
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
    console.error(`API error ${res.status}: ${text}`);
    process.exit(1);
  }

  return res.json();
}

switch (command) {
  case "start": {
    const { startServer } = await import("@mind/server");
    await startServer();
    break;
  }

  case "pause": {
    console.log(JSON.stringify(await apiCall("/admin/pause", "POST"), null, 2));
    break;
  }

  case "resume": {
    console.log(JSON.stringify(await apiCall("/admin/resume", "POST"), null, 2));
    break;
  }

  case "observe": {
    const data = await apiCall("/metrics");
    console.log(JSON.stringify(data, null, 2));
    break;
  }

  case "metrics": {
    const window = args[0] ?? "7d";
    const data = await apiCall(`/metrics?window=${window}`);
    console.log(JSON.stringify(data, null, 2));
    break;
  }

  case "health": {
    const data = await apiCall("/health");
    console.log(JSON.stringify(data, null, 2));
    break;
  }

  default: {
    console.log(
      [
        "mind — local attention manager",
        "",
        "Commands:",
        "  mind start           Start the server and all adapters",
        "  mind pause           Block all sends immediately (kill switch)",
        "  mind resume          Clear the kill switch",
        "  mind observe         Show current metrics",
        "  mind metrics [7d]    Show metrics for a window (e.g. 7d, 2w)",
        "  mind health          Show server and adapter status",
      ].join("\n"),
    );
    if (command && command !== "help") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
  }
}
