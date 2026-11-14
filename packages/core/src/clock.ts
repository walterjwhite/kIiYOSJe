/**
 * Minimal clock abstraction so tests can inject a fixed time.
 */

export interface Clock {
  now(): Date;
}

export const realClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(d: Date): Clock {
  return { now: () => d };
}
