/**
 * Coverage curve — the one metric the thesis can fail on.
 *
 * The claim in PLAN §1 is that absorb rate rises as Directions cover more of
 * what arrives. That is a falsifiable claim only if it is plotted against the
 * number of Directions in force, week by week. This module is the arithmetic;
 * `GET /metrics/coverage` is the endpoint, nothing here touches the database.
 *
 * Absorb rate is deliberately *not* the same as "messages handled": a signal
 * that was answered but never answered back counts as absorbed but unanswered,
 * which is reported separately so a rising absorb rate cannot hide a thread
 * that went quiet.
 */

export const COVERAGE_TARGET = 0.6;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface CoverageSignalRow {
  receivedAt: string;
  disposition: string;
  awaitingReplyAt?: string | null;
  replyReceivedAt?: string | null;
}

export interface CoverageThoughtRow {
  createdAt: string;
}

export interface CoverageDirectionRow {
  createdAt: string;
  enabled: boolean;
}

export interface CoverageBucket {
  /** ISO date (UTC) of the Monday that starts this week. */
  weekStart: string;
  signals: number;
  absorbed: number;
  /** Absorbed, a reply went out, and the other side never answered. */
  absorbedUnanswered: number;
  absorbRate: number | null;
  thoughts: number;
  /** signals ÷ thoughts, the PLAN §1 ratio. */
  ratio: number | null;
  /** Directions enabled at the time (created before this week ended). */
  directions: number;
  meetsTarget: boolean;
}

export interface CoverageReport {
  weeks: number;
  target: number;
  buckets: CoverageBucket[];
  totals: {
    signals: number;
    absorbed: number;
    absorbedUnanswered: number;
    absorbRate: number | null;
    thoughts: number;
    ratio: number | null;
    meetsTarget: boolean;
  };
}

export interface CoverageInput {
  signals: CoverageSignalRow[];
  thoughts: CoverageThoughtRow[];
  directions: CoverageDirectionRow[];
}

export interface CoverageOptions {
  weeks?: number | undefined;
  now?: Date | undefined;
  target?: number | undefined;
}

/** UTC Monday 00:00 of the week containing `date`. */
export function mondayOf(date: Date): Date {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const sinceMonday = (day.getUTCDay() + 6) % 7; // 0 = Monday
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day;
}

export function weeklyCoverage(
  input: CoverageInput,
  options: CoverageOptions = {},
): CoverageReport {
  const weeks = options.weeks ?? 12;
  const target = options.target ?? COVERAGE_TARGET;
  const now = options.now ?? new Date();

  const currentMonday = mondayOf(now).getTime();
  const firstMonday = currentMonday - (weeks - 1) * WEEK_MS;

  const buckets: CoverageBucket[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(firstMonday + i * WEEK_MS).toISOString().slice(0, 10),
    signals: 0,
    absorbed: 0,
    absorbedUnanswered: 0,
    absorbRate: null,
    thoughts: 0,
    ratio: null,
    directions: 0,
    meetsTarget: false,
  }));

  const bucketIndex = (timestamp: number): number | null => {
    const week = mondayOf(new Date(timestamp)).getTime();
    const index = Math.floor((week - firstMonday) / WEEK_MS);
    return index >= 0 && index < weeks ? index : null;
  };

  for (const signal of input.signals) {
    const at = Date.parse(signal.receivedAt);
    if (Number.isNaN(at)) continue;
    const index = bucketIndex(at);
    if (index === null) continue;

    const bucket = buckets[index]!;
    bucket.signals += 1;
    if (signal.disposition === "absorbed") {
      bucket.absorbed += 1;
      if (signal.awaitingReplyAt && !signal.replyReceivedAt) {
        bucket.absorbedUnanswered += 1;
      }
    }
  }

  for (const thought of input.thoughts) {
    const at = Date.parse(thought.createdAt);
    if (Number.isNaN(at)) continue;
    const index = bucketIndex(at);
    if (index !== null) buckets[index]!.thoughts += 1;
  }

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i]!;
    // Approximate: the schema records when a Direction was created and whether
    // it is enabled now, not an enable/disable history. Good enough to see the
    // curve move; not an audit of when coverage changed.
    const weekEnd = firstMonday + (i + 1) * WEEK_MS;
    bucket.directions = input.directions.filter(
      (direction) =>
        direction.enabled && Date.parse(direction.createdAt) < weekEnd,
    ).length;
    bucket.absorbRate =
      bucket.signals > 0
        ? +(bucket.absorbed / bucket.signals).toFixed(4)
        : null;
    bucket.ratio =
      bucket.thoughts > 0
        ? +(bucket.signals / bucket.thoughts).toFixed(2)
        : null;
    bucket.meetsTarget =
      bucket.absorbRate !== null && bucket.absorbRate >= target;
  }

  const signals = buckets.reduce((sum, b) => sum + b.signals, 0);
  const absorbed = buckets.reduce((sum, b) => sum + b.absorbed, 0);
  const absorbedUnanswered = buckets.reduce(
    (sum, b) => sum + b.absorbedUnanswered,
    0,
  );
  const thoughts = buckets.reduce((sum, b) => sum + b.thoughts, 0);
  const absorbRate = signals > 0 ? +(absorbed / signals).toFixed(4) : null;

  return {
    weeks,
    target,
    buckets,
    totals: {
      signals,
      absorbed,
      absorbedUnanswered,
      absorbRate,
      thoughts,
      ratio: thoughts > 0 ? +(signals / thoughts).toFixed(2) : null,
      meetsTarget: absorbRate !== null && absorbRate >= target,
    },
  };
}
