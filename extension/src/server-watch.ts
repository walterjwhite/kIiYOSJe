/**
 * The mind server is a separate process, so it can start after the extension
 * does. When a tree has failed to load, re-check it on a slow timer so it
 * recovers on its own — no click, no notification.
 */

export interface RefreshableProvider {
  readonly hasError: boolean;
  refresh(): void;
}

export interface Disposable {
  dispose(): void;
}

export const SERVER_POLL_MS = 15_000;

export function watchForServerRecovery(
  providers: readonly RefreshableProvider[],
  intervalMs: number = SERVER_POLL_MS,
): Disposable {
  const timer = setInterval(() => {
    for (const provider of providers) {
      if (provider.hasError) provider.refresh();
    }
  }, intervalMs);
  return { dispose: () => clearInterval(timer) };
}
