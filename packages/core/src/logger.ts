/**
 * Pino logger. Dev mode pretty-prints; production writes JSON to file.
 */

import pino from "pino";
import { logPath } from "./config.js";

function buildLogger() {
  const isDev =
    process.env["NODE_ENV"] !== "production" &&
    process.env["MIND_LOG_JSON"] !== "true";

  if (isDev) {
    return pino({ level: "debug" });
  }

  return pino(
    { level: process.env["MIND_LOG_LEVEL"] ?? process.env["LOG_LEVEL"] ?? "info" },
    pino.destination({ dest: logPath(), sync: false }),
  );
}

export const logger = buildLogger();
