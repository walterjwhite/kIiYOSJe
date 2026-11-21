/**
 * Pino logger. Dev mode writes to stdout; production writes JSON to a file.
 *
 * Every record runs through the redaction list below, so a credential that
 * reaches a log call — through an error object, a fetch config, or a config
 * dump — is written as `[redacted]` instead of leaking into the log file, a
 * terminal, or a demo recording. Redaction lives here rather than at each call
 * site because a new call site cannot be trusted to remember it.
 */

import pino from "pino";
import { logPath } from "./config.js";

/** Field names that must never be written verbatim. */
const SECRET_KEYS = [
  "apiKey",
  "api_key",
  "clientSecret",
  "client_secret",
  "refreshToken",
  "refresh_token",
  "accessToken",
  "access_token",
  "idToken",
  "id_token",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
];

/**
 * Covered at the top level, one level down (a credential object, `headers`), and
 * two levels down (`req.headers.authorization` inside a request-scoped record).
 */
const REDACT_OPTIONS: { paths: string[]; censor: string } = {
  paths: [
    ...SECRET_KEYS,
    ...SECRET_KEYS.map((key) => `*.${key}`),
    ...SECRET_KEYS.map((key) => `*.*.${key}`),
    "req.headers.authorization",
    "req.headers.cookie",
    "request.headers.authorization",
    "headers.authorization",
    "headers.cookie",
    "err.config.headers.authorization",
    "error.config.headers.authorization",
  ],
  censor: "[redacted]",
};

function buildLogger() {
  const isDev = process.env["NODE_ENV"] !== "production" && process.env["MIND_LOG_JSON"] !== "true";

  if (isDev) {
    return pino({ level: "debug", redact: REDACT_OPTIONS });
  }

  return pino(
    {
      level: process.env["MIND_LOG_LEVEL"] ?? process.env["LOG_LEVEL"] ?? "info",
      redact: REDACT_OPTIONS,
    },
    pino.destination({ dest: logPath(), sync: false }),
  );
}

export const logger = buildLogger();
