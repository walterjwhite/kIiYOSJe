/**
 * The coverage curve — geometry and wording for the one chart the thesis can
 * fail on. Pure, no vscode import, unit-tested.
 *
 * The payload comes from `GET /metrics/coverage`: absorb rate per week against
 * the number of Directions in force. Two things the drawing refuses to hide:
 * a week with no traffic is a gap, not 0%, and signals that were absorbed but
 * never answered are drawn beside the rate rather than folded into it.
 */

export const COVERAGE_VIEWBOX = { width: 900, height: 270 } as const;
export const COVERAGE_TARGET_DEFAULT = 0.6;

const LEFT = 64;
const RIGHT = 24;
const TOP = 18;
const RATE_BOTTOM = 172;
const BAR_BASE = 236;
const BAR_MAX = 40;
const LABEL_Y = 256;

/** The pixel frame the panel draws into, so both files use one set of numbers. */
export const COVERAGE_LAYOUT = {
  left: LEFT,
  right: RIGHT,
  top: TOP,
  rateBottom: RATE_BOTTOM,
  barBase: BAR_BASE,
  barMax: BAR_MAX,
  labelY: LABEL_Y,
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CoverageBucket {
  /** ISO date (UTC) of the Monday that starts the week. */
  weekStart: string;
  signals: number;
  absorbed: number;
  absorbedUnanswered: number;
  absorbRate: number | null;
  thoughts: number;
  ratio: number | null;
  directions: number;
  meetsTarget: boolean;
}

export interface CoverageReport {
  weeks?: number;
  target?: number;
  scope?: string;
  /** Signals left out of the rate because no authored Direction covered them. */
  excludedFallback?: number;
  buckets: CoverageBucket[];
}

export interface CoverageTick {
  y: number;
  label: string;
}

export interface CoveragePoint {
  weekStart: string;
  label: string;
  x: number;
  /** Null when the week had no traffic — a gap in the line, never 0%. */
  y: number | null;
  directionsY: number;
  directions: number;
  absorbRate: number | null;
  signals: number;
  absorbedUnanswered: number;
  unansweredHeight: number;
  meetsTarget: boolean;
}

export interface CoverageModel {
  points: CoveragePoint[];
  /** One polyline per unbroken run of rated weeks. */
  rateSegments: string[];
  directionsPath: string;
  targetY: number;
  target: number;
  ticks: CoverageTick[];
  baselineY: number;
  barBaseY: number;
  labelY: number;
  hasData: boolean;
  headline: string;
  caption: string;
  absorbedUnanswered: number;
  weeks: number;
}

const round = (n: number): number => Math.round(n * 10) / 10;

const clampRate = (rate: number): number => Math.min(1, Math.max(0, rate));

const rateY = (rate: number): number => RATE_BOTTOM - clampRate(rate) * (RATE_BOTTOM - TOP);

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

/** "2026-11-02" → "2 Nov". UTC on purpose: week starts are UTC Mondays. */
export function shortWeek(iso: string): string {
  const day = iso.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`.trim();
}

function headlineFor(rated: readonly CoveragePoint[], target: number): string {
  const first = rated[0];
  const last = rated.at(-1);
  if (!first || !last) return "No signal reached an explicit Direction yet.";
  const at = (p: CoveragePoint) =>
    `${pct(p.absorbRate ?? 0)} absorbed at ${p.directions} Direction${p.directions === 1 ? "" : "s"}`;
  if (first === last) {
    return `${at(last)}${last.meetsTarget ? "" : ` — below the ${pct(target)} target`}.`;
  }
  const up = (last.absorbRate ?? 0) >= (first.absorbRate ?? 0);
  return `${at(last)}, ${up ? "up" : "down"} from ${pct(first.absorbRate ?? 0)} at ${first.directions}.`;
}

export function buildCoverage(report: CoverageReport): CoverageModel {
  const buckets = report.buckets ?? [];
  const target = report.target ?? COVERAGE_TARGET_DEFAULT;
  const n = buckets.length;
  const plotRight = COVERAGE_VIEWBOX.width - RIGHT;
  const x = (i: number): number =>
    n <= 1 ? (LEFT + plotRight) / 2 : LEFT + (i * (plotRight - LEFT)) / (n - 1);

  // Both lines share one vertical scale each: rate in 0..1, Directions against
  // the busiest week, so "more Directions" is visibly higher on the chart.
  const maxDirections = Math.max(1, ...buckets.map((b) => b.directions));
  const maxUnanswered = Math.max(1, ...buckets.map((b) => b.absorbedUnanswered));

  const points: CoveragePoint[] = buckets.map((b, i) => ({
    weekStart: b.weekStart,
    label: shortWeek(b.weekStart),
    x: round(x(i)),
    y: b.absorbRate == null ? null : round(rateY(b.absorbRate)),
    directionsY: round(RATE_BOTTOM - (b.directions / maxDirections) * (RATE_BOTTOM - TOP)),
    directions: b.directions,
    absorbRate: b.absorbRate,
    signals: b.signals,
    absorbedUnanswered: b.absorbedUnanswered,
    unansweredHeight: round((b.absorbedUnanswered / maxUnanswered) * BAR_MAX),
    meetsTarget: b.meetsTarget,
  }));

  const rateSegments: string[] = [];
  let run: string[] = [];
  for (const p of points) {
    if (p.y == null) {
      if (run.length > 0) rateSegments.push(run.join(" "));
      run = [];
      continue;
    }
    run.push(`${p.x},${p.y}`);
  }
  if (run.length > 0) rateSegments.push(run.join(" "));

  const head = points[0];
  const directionsPath = head
    ? `M${head.x},${head.directionsY}${points
        .slice(1)
        .map((p) => ` H${p.x} V${p.directionsY}`)
        .join("")}`
    : "";

  const rated = points.filter((p) => p.absorbRate != null);
  const excluded = report.excludedFallback;

  return {
    points,
    rateSegments,
    directionsPath,
    targetY: round(rateY(target)),
    target,
    ticks: [1, 0.5, 0].map((rate) => ({ y: round(rateY(rate)), label: pct(rate) })),
    baselineY: RATE_BOTTOM,
    barBaseY: BAR_BASE,
    labelY: LABEL_Y,
    hasData: points.some((p) => p.signals > 0),
    headline: headlineFor(rated, target),
    caption:
      excluded == null
        ? "Explicit Directions only; the catch-all is excluded."
        : `Explicit Directions only · catch-all excluded (${excluded} signal${excluded === 1 ? "" : "s"})`,
    absorbedUnanswered: points.reduce((n2, p) => n2 + p.absorbedUnanswered, 0),
    weeks: report.weeks ?? buckets.length,
  };
}
