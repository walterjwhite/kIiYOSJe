/**
 * Evaluation metrics (`ai-quality.md`). Pure: no I/O, no database.
 *
 * A signal counts as surfaced when its disposition is `escalated` or
 * `promoted`. A metric whose denominator is empty is `null`, never 0 or 1, so a
 * report cannot look perfect because nothing was measured.
 */

const CATCH_ALL = "system/catch-all";

export interface FixtureOutcome {
  readonly id: string;
  /** Reason the pipeline is known to disagree with the label, or null. */
  readonly known: string | null;
  /** Set when ingest() threw for this fixture. */
  readonly error: string | null;
  readonly expectedDirectionId: string;
  readonly expectedSurfaced: boolean;
  readonly directionId: string | null;
  readonly disposition: string;
  readonly thoughtCreated: boolean;
}

export interface Failure {
  readonly id: string;
  readonly reason: string;
}

export interface Metrics {
  /** Fixtures that count toward the numbers (not known, not errored). */
  readonly counted: number;
  readonly surfaceRecall: number | null;
  readonly surfacePrecision: number | null;
  readonly falseAbsorbRate: number | null;
  readonly directionAccuracy: number | null;
  /** Share of counted fixtures that matched the catch-all. */
  readonly catchAllShare: number | null;
  readonly gateViolations: number;
  /** Counted signals divided by Thoughts created. */
  readonly ratio: number | null;
  readonly failures: readonly Failure[];
  readonly known: readonly { id: string; reason: string }[];
}

const share = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const isSurfaced = (disposition: string): boolean =>
  disposition === "escalated" || disposition === "promoted";

export function computeMetrics(
  outcomes: readonly FixtureOutcome[],
  gateViolations: number,
): Metrics {
  const failures: Failure[] = [];
  const known: { id: string; reason: string }[] = [];
  const counted: FixtureOutcome[] = [];

  for (const o of outcomes) {
    if (o.error !== null) {
      failures.push({ id: o.id, reason: `error: ${o.error}` });
    } else if (o.known !== null) {
      known.push({ id: o.id, reason: o.known });
    } else {
      counted.push(o);
    }
  }

  let wanted = 0;
  let surfaced = 0;
  let truePositive = 0;
  let absorbed = 0;
  let wrongAbsorb = 0;
  let explicitExpected = 0;
  let explicitRight = 0;
  let catchAll = 0;
  let thoughts = 0;

  for (const o of counted) {
    const got = isSurfaced(o.disposition);
    if (o.expectedSurfaced) wanted++;
    if (got) surfaced++;
    if (got && o.expectedSurfaced) truePositive++;
    if (o.disposition === "absorbed") {
      absorbed++;
      if (o.expectedSurfaced) wrongAbsorb++;
    }
    if (o.thoughtCreated) thoughts++;
    if (o.directionId === CATCH_ALL) catchAll++;

    if (o.expectedDirectionId !== CATCH_ALL) {
      explicitExpected++;
      if (o.directionId === o.expectedDirectionId) explicitRight++;
    }

    if (got !== o.expectedSurfaced) {
      failures.push({
        id: o.id,
        reason: `expected ${o.expectedSurfaced ? "surfaced" : "absorbed"}, got ${o.disposition}`,
      });
    } else if (o.directionId !== o.expectedDirectionId) {
      failures.push({
        id: o.id,
        reason: `expected Direction ${o.expectedDirectionId}, got ${o.directionId ?? "none"}`,
      });
    }
  }

  return {
    counted: counted.length,
    surfaceRecall: share(truePositive, wanted),
    surfacePrecision: share(truePositive, surfaced),
    falseAbsorbRate: share(wrongAbsorb, absorbed),
    directionAccuracy: share(explicitRight, explicitExpected),
    catchAllShare: share(catchAll, counted.length),
    gateViolations,
    ratio: share(counted.length, thoughts),
    failures: failures.sort((a, b) => a.id.localeCompare(b.id)),
    known,
  };
}
