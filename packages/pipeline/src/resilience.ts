/**
 * Protects model calls from a slow or failing provider, using `cockatiel` (MIT).
 *
 * Per call, outermost first: retry with exponential backoff and jitter, a
 * circuit breaker, a concurrency cap (with a bounded queue), and a timeout that
 * aborts the request. The numbers come from `resilience.json`
 * (`@mind/core` resilience-settings.ts). One policy instance is shared by every
 * model call in the process, so the breaker sees all of them. Changing the
 * settings builds a fresh policy on the next call.
 *
 * What fails: a timeout, HTTP 408, 409, 429 and 5xx, and a dropped connection are
 * retried. A bad request, bad credentials, or an answer that is not valid
 * structure are not, because asking again does not change them. When the breaker
 * is open, or too many calls are already waiting, the call fails at once with a
 * `ModelUnavailableError`. Callers treat that like any model failure: the signal
 * is held for the operator, never absorbed.
 */

import type { ResilienceSettings } from "@mind/core";
import { resilienceSettings } from "@mind/core";
import {
  type BulkheadPolicy,
  type CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  ExponentialBackoff,
  type IPolicy,
  TimeoutStrategy,
  bulkhead,
  circuitBreaker,
  handleWhen,
  isBrokenCircuitError,
  isBulkheadRejectedError,
  isTaskCancelledError,
  retry,
  timeout,
  wrap,
} from "cockatiel";

/** Calls allowed to wait for a free slot. More than this fail at once. */
const QUEUE_LIMIT = 50;

export class ModelUnavailableError extends Error {
  constructor(
    readonly code: "circuit_open" | "queue_full" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429]);
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** True for a failure that asking again could fix. Reads fields, never the message text of a prompt. */
export function isRetryableModelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof ModelUnavailableError) return err.code === "timeout";
  const e = err as Error & {
    statusCode?: unknown;
    isRetryable?: unknown;
    cause?: { code?: unknown };
    code?: unknown;
  };
  if (e.isRetryable === true) return true;
  if (typeof e.statusCode === "number") {
    return RETRYABLE_STATUS.has(e.statusCode) || e.statusCode >= 500;
  }
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  const code = e.cause?.code ?? e.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  // An agent over stdio reports its own timeouts and exits as plain errors.
  return /timed out|timeout|exited|ECONNRESET/i.test(e.message) && !(err instanceof SyntaxError);
}

interface Built {
  readonly key: string;
  readonly policy: IPolicy;
  readonly breaker: CircuitBreakerPolicy;
  readonly slots: BulkheadPolicy;
}

let current: Built | undefined;

function build(settings: ResilienceSettings): Built {
  const handle = handleWhen(isRetryableModelError);
  const retryPolicy = retry(handle, {
    maxAttempts: settings.retries,
    backoff: new ExponentialBackoff({
      initialDelay: settings.retryDelayMs,
      maxDelay: Math.max(settings.retryDelayMs, 30_000),
    }),
  });
  const breaker = circuitBreaker(handle, {
    halfOpenAfter: settings.breakerResetSeconds * 1000,
    breaker: new ConsecutiveBreaker(settings.breakerFailures),
  });
  const slots = bulkhead(settings.maxConcurrent, QUEUE_LIMIT);
  const limit = timeout(settings.timeoutSeconds * 1000, TimeoutStrategy.Aggressive);
  return {
    key: JSON.stringify(settings),
    policy: wrap(retryPolicy, breaker, slots, limit),
    breaker,
    slots,
  };
}

function policyFor(settings: ResilienceSettings): Built {
  if (!current || current.key !== JSON.stringify(settings)) current = build(settings);
  return current;
}

/**
 * Run one model call under the policy. `call` receives an AbortSignal that fires
 * on timeout; hand it to the HTTP request so the work actually stops.
 * `timeoutOverrideMs` exists for tests.
 */
export async function withResilience<T>(
  call: (signal: AbortSignal) => Promise<T>,
  settings: ResilienceSettings = resilienceSettings(),
  timeoutOverrideMs?: number,
): Promise<T> {
  const effective =
    timeoutOverrideMs === undefined
      ? settings
      : { ...settings, timeoutSeconds: timeoutOverrideMs / 1000 };
  const { policy } = policyFor(effective);
  try {
    return await policy.execute(async ({ signal }) => {
      try {
        return await call(signal);
      } catch (err) {
        // The call failed because the timeout aborted it. Say so, whatever the
        // HTTP client chose to throw.
        if (signal.aborted) {
          throw new ModelUnavailableError(
            "timeout",
            "The model call took too long and was stopped.",
          );
        }
        throw err;
      }
    });
  } catch (err) {
    if (isBrokenCircuitError(err)) {
      throw new ModelUnavailableError(
        "circuit_open",
        "The model provider kept failing, so calls are paused for a short while.",
      );
    }
    if (isBulkheadRejectedError(err)) {
      throw new ModelUnavailableError("queue_full", "Too many model calls are already waiting.");
    }
    if (isTaskCancelledError(err)) {
      throw new ModelUnavailableError("timeout", "The model call took too long and was stopped.");
    }
    throw err;
  }
}

export interface ResilienceState {
  readonly circuit: "closed" | "open" | "half-open" | "isolated";
  readonly running: number;
  readonly queued: number;
}

/** For `/health`: whether calls are flowing, paused, or waiting. */
export function resilienceState(
  settings: ResilienceSettings = resilienceSettings(),
): ResilienceState {
  const { breaker, slots } = policyFor(settings);
  const circuit =
    breaker.state === CircuitState.Closed
      ? "closed"
      : breaker.state === CircuitState.Open
        ? "open"
        : breaker.state === CircuitState.HalfOpen
          ? "half-open"
          : "isolated";
  return {
    circuit,
    running: settings.maxConcurrent - slots.executionSlots,
    queued: QUEUE_LIMIT - slots.queueSlots,
  };
}

/** Forget all state. For tests. */
export function resetResilience(): void {
  current = undefined;
}

/**
 * A log-safe description of a model failure: the error type, HTTP status, and
 * network code, never the message. An AI SDK error carries the request body
 * (which is the prompt, and so the message text) and the response body, so
 * logging the error object would write message content to the log
 * (`observability.md`, `privacy-data.md` rule 3).
 */
export function describeModelError(err: unknown): {
  type: string;
  statusCode?: number;
  code?: string;
} {
  if (!(err instanceof Error)) return { type: typeof err };
  const e = err as Error & { statusCode?: unknown; code?: unknown; cause?: { code?: unknown } };
  const code = typeof e.code === "string" ? e.code : e.cause?.code;
  return {
    type: err.name,
    ...(typeof e.statusCode === "number" ? { statusCode: e.statusCode } : {}),
    ...(typeof code === "string" ? { code } : {}),
    ...(err instanceof ModelUnavailableError ? { code: err.code } : {}),
  };
}

/**
 * The provider could not answer even after the policy's retries (or the circuit
 * is open). The signal is not judged: it is held and tried again later
 * (deferred-retry.ts). `reason` is log-safe: a status, a network code, or a
 * policy code, never message text.
 */
export class ModelDeferral extends Error {
  constructor(readonly reason: string) {
    super(`model unavailable: ${reason}`);
    this.name = "ModelDeferral";
  }
}

/** Short, log-safe reason for a failure that should be retried later, or null if retrying will not help. */
export function deferralReason(err: unknown): string | null {
  if (!(err instanceof ModelUnavailableError) && !isRetryableModelError(err)) return null;
  const d = describeModelError(err);
  if (d.statusCode !== undefined) return `http_${d.statusCode}`;
  return d.code ?? d.type;
}
