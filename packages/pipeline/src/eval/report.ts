/** Text and JSON output for an evaluation run. Pure. */

import type { EvalReport } from "./runner.js";

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null): string => (v === null ? "n/a" : v.toFixed(2));

export function formatReport(report: EvalReport): string {
  const m = report.metrics;
  const lines = [
    `Evaluation, ${report.date}`,
    `Model: ${report.model}${report.live ? " (live)" : ""}`,
    `Prompt versions: ${Object.entries(report.promptVersions)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    `Fixtures: ${report.fixtures} (${m.counted} counted, ${m.known.length} known)`,
    ...(report.live
      ? []
      : [`Recorded answers a live run must confirm: ${report.liveChecks} (run with --live)`]),
    "",
    `Surface recall      ${pct(m.surfaceRecall)}   target >= 95%`,
    `Surface precision   ${pct(m.surfacePrecision)}   target >= 60%`,
    `False-absorb rate   ${pct(m.falseAbsorbRate)}   target <= 2%`,
    `Direction accuracy  ${pct(m.directionAccuracy)}   explicit Directions only`,
    `Catch-all share     ${pct(m.catchAllShare)}`,
    `Gate violations     ${m.gateViolations}   must be 0`,
    `Signals per Thought ${num(m.ratio)}`,
  ];
  if (m.failures.length > 0) {
    lines.push("", "Failing fixtures:");
    for (const f of m.failures) lines.push(`  ${f.id}: ${f.reason}`);
  }
  if (m.known.length > 0) {
    lines.push("", "Known gaps (not counted):");
    for (const k of m.known) lines.push(`  ${k.id}: ${k.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatJson(report: EvalReport): string {
  const { outcomes: _outcomes, ...rest } = report;
  return `${JSON.stringify(rest, null, 2)}\n`;
}
