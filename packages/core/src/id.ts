/**
 * Deterministic-ish ID generation.
 * Uses crypto.randomUUID() — no dependency needed in Node 24.
 */

export function newId(): string {
  return crypto.randomUUID();
}
