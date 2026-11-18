/**
 * One place that turns a thrown error into a response: validation is the
 * client's fault (400), an upstream adapter failure is a bad gateway (502),
 * everything else is logged and reported as 500.
 */

import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { HttpError, ValidationError, logger } from "@mind/core";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const bodyLimit: MiddlewareHandler = async (c, next) => {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new ValidationError("request body too large");
  }
  await next();
};

export function errorResponse(err: Error, c: Context): Response {
  // Hono's validators throw HTTPException for malformed or invalid bodies.
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ValidationError) {
    return c.json({ error: err.message }, 400);
  }
  if (err instanceof HttpError) return c.json({ error: err.message }, 502);
  if (err instanceof SyntaxError) {
    return c.json({ error: "request body must be JSON" }, 400);
  }
  logger.error({ err }, "api: unhandled error");
  return c.json({ error: String(err) }, 500);
}
