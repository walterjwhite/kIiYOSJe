/**
 * Thin fetch wrapper for adapters. Every external API call goes through here so
 * timeouts, auth headers, form bodies, and error text are handled one way.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

export interface JsonRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function requestJson<T>(
  url: string,
  request: JsonRequest = {},
): Promise<T> {
  const body =
    request.json !== undefined
      ? JSON.stringify(request.json)
      : request.form !== undefined
        ? new URLSearchParams(request.form).toString()
        : undefined;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...request.headers,
  };
  if (request.json !== undefined) headers["Content-Type"] = "application/json";
  if (request.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method: request.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, url, text);
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}
