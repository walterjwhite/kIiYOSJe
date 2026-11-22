/**
 * Plain-language wording for the Learnings view. No vscode import, so it is
 * unit-tested. Everything here describes a proposal the rule-based loop already
 * produced; it never changes what is proposed.
 */

export interface ProposalView {
  kind: "narrow" | "widen" | "new";
  directionId: string | null;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  evidence: { total: number; discarded: number; sent: number; overrideRate: number };
}

export interface ProposalText {
  /** One line saying what is suggested. */
  headline: string;
  /** The exact edit, in words. */
  change: string;
  /** Why, with the counts behind it. */
  why: string;
  /** What Accept does. */
  effect: string;
}

const percent = (n: number): string => `${Math.round(n * 100)}%`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function asPercent(v: unknown): string {
  return typeof v === "number" ? percent(v) : String(v);
}

const AUTONOMY_MEANING: Record<string, string> = {
  observe: "only records what it would do",
  draft: "writes a draft and waits for you",
  send: "may send after every send gate passes",
};

function autonomyLabel(v: unknown): string {
  const key = String(v);
  const meaning = AUTONOMY_MEANING[key];
  return meaning ? `${key} (${meaning})` : key;
}

export function describeProposal(p: ProposalView): ProposalText {
  const name = p.directionId ?? "";
  const e = p.evidence;
  const days = 7;

  const yamlEffect = p.directionId
    ? `Accept updates the saved Direction and shows the line to change in directions/${p.directionId}.yaml. The file is not edited for you, and until you edit it a restart will undo the change. Reject hides this suggestion for 30 days.`
    : "Accept shows what to add. Nothing is created for you. Reject hides this suggestion for 30 days.";

  if (p.kind === "new") {
    const sender = String(p.proposedValue);
    return {
      headline: `Add a Direction for ${sender}`,
      change: `New Direction that matches messages from ${sender}.`,
      why: `${plural(e.total, "message")} from this sender matched no Direction in the last ${days} days, so each one landed in the catch-all and needed your attention.`,
      effect: yamlEffect,
    };
  }

  if (p.field === "confidenceMin" && p.kind === "narrow") {
    return {
      headline: `Be pickier about "${name}"`,
      change: `Minimum confidence ${asPercent(p.currentValue)} → ${asPercent(p.proposedValue)}. Below that, a message is shown to you instead of handled by this Direction.`,
      why: `You discarded ${e.discarded} of its ${plural(e.total, "decision")} in the last ${days} days (${percent(e.overrideRate)}). Above 20% suggests it is catching things it should not.`,
      effect: yamlEffect,
    };
  }

  if (p.field === "confidenceMin") {
    return {
      headline: `Be less picky about "${name}"`,
      change: `Minimum confidence ${asPercent(p.currentValue)} → ${asPercent(p.proposedValue)}. More messages are handled by this Direction without reaching you.`,
      why: `You approved ${plural(e.sent, "send")} and discarded ${percent(e.overrideRate)} of its ${plural(e.total, "decision")} in the last ${days} days. Under 10% suggests the bar can come down.`,
      effect: yamlEffect,
    };
  }

  if (p.field === "autonomy") {
    return {
      headline:
        p.proposedValue === "send"
          ? `Allow "${name}" to send`
          : `Start drafting replies for "${name}"`,
      change: `Autonomy ${autonomyLabel(p.currentValue)} → ${autonomyLabel(p.proposedValue)}.${p.proposedValue === "send" ? " Sending still needs MIND_SEND_ENABLED=true and no pause." : ""}`,
      why: `You approved ${plural(e.sent, "send")} and discarded ${percent(e.overrideRate)} of its ${plural(e.total, "decision")} in the last ${days} days. Under 10% with at least 3 sends suggests it can do more.`,
      effect: yamlEffect,
    };
  }

  return {
    headline: `Change ${p.field} for "${name}"`,
    change: `${p.field}: ${JSON.stringify(p.currentValue)} → ${JSON.stringify(p.proposedValue)}`,
    why: p.rationale,
    effect: yamlEffect,
  };
}

export interface ScheduleView {
  window: { windowStart: string; windowEnd: string };
  lastRun: { at: string; trigger: "schedule" | "manual"; proposalCount: number } | null;
}

export function describeSchedule(s: ScheduleView, format: (iso: string) => string): string {
  const window =
    s.window.windowStart === s.window.windowEnd
      ? "at any time of day"
      : `between ${s.window.windowStart} and ${s.window.windowEnd}`;
  const next = `Runs by itself once a night ${window}, in this computer's time. Change it in Settings.`;
  if (!s.lastRun) return `${next} It has not run yet.`;
  const who = s.lastRun.trigger === "schedule" ? "overnight" : "by you";
  return `${next} Last run: ${format(s.lastRun.at)}, ${who}, ${plural(s.lastRun.proposalCount, "new suggestion")}.`;
}
