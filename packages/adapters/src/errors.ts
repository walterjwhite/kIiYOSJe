/**
 * Shared adapter error. Adapters throw this when credentials are missing so the
 * server can report "not configured" without a stack trace, and a single source
 * failing never stops the others from starting.
 */

export class AdapterNotConfiguredError extends Error {
  constructor(
    readonly adapter: string,
    readonly missing: string,
  ) {
    super(`${adapter}: not configured (${missing})`);
    this.name = "AdapterNotConfiguredError";
  }
}

export function isNotConfigured(err: unknown): err is AdapterNotConfiguredError {
  return err instanceof AdapterNotConfiguredError;
}
