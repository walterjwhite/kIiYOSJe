/**
 * Prompt-injection tripwire for inbound message text.
 *
 * Uses the pattern layer (Tier 1) of `@stackone/defender`: Apache-2.0, in
 * process, no network, no model. It catches known override phrasing ("ignore
 * all previous rules", "reveal your system prompt") including common
 * obfuscation. It does NOT catch a novel or paraphrased instruction; that needs
 * its ML layer (Tier 2), which adds about 270 MB of native dependencies and is
 * not enabled here. See `.kiro/specs/injection-detection`.
 *
 * A flagged signal is held for the operator: it skips every model call, cannot
 * be absorbed, drafted, or sent, and becomes a Thought. Detection is a
 * tripwire, not the defense. The defenses that must hold when it misses are the
 * delimited prompts and the send gates (`security.md` rules 2 and 3).
 *
 * The result carries pattern names and categories only. The matched text is
 * message content and is never kept, logged, or stored.
 */

import type { ClassifierOutput } from "./classify.js";
import { createPromptDefense } from "@stackone/defender";

/** Longest text scanned. Bounds the cost of one very long message. */
const MAX_SCAN_CHARS = 20_000;

export interface InjectionFinding {
  readonly risk: "medium" | "high";
  /** Pattern names such as `ignore_previous`. */
  readonly patterns: readonly string[];
  /** Categories such as `instruction_override`. */
  readonly categories: readonly string[];
}

/**
 * What the pipeline uses in place of a model answer for a flagged signal.
 * Confidence 0 is below every Direction's minimum, so `decide()` escalates it
 * whatever the Direction's posture or autonomy.
 */
export const INJECTION_HOLD: ClassifierOutput = {
  confidence: 0,
  intent: "possible prompt injection, held for review",
  signalKind: "information",
  urgency: "medium",
  commitment: null,
  commitmentDueDate: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: false,
  answerBlocker: null,
};

// Pattern layer only. Created once; it holds compiled patterns, no per-message state.
const defense = createPromptDefense({ enableTier2: false });

/**
 * Scan a subject and body. Returns null when nothing matched. Structural flags
 * (length, entropy, formatting) are ignored on purpose: long newsletters and
 * encoded attachments would trip them and bury the operator in false alarms.
 */
export function scanForInjection(
  subject: string | null | undefined,
  body: string,
): InjectionFinding | null {
  const text = `${subject ?? ""}\n${body}`.slice(0, MAX_SCAN_CHARS).trim();
  if (text === "") return null;

  const strong = defense.analyze(text).matches.filter((m) => m.severity !== "low");
  if (strong.length === 0) return null;

  return {
    risk: strong.some((m) => m.severity === "high") ? "high" : "medium",
    patterns: [...new Set(strong.map((m) => m.pattern))],
    categories: [...new Set(strong.map((m) => m.category))],
  };
}
