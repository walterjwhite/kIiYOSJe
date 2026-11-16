/**
 * Demo scenario types.
 *
 * A persona is a 2-3 week slice of someone's real inbox pressure, authored by
 * hand so the pipeline exercises every decision path deliberately rather than
 * by chance. Each signal carries its own pre-computed ClassifierOutput so the
 * demo never calls a real LLM — it is deterministic, free, and fast, and it
 * proves the pipeline's match/decide/record/escalate machinery rather than
 * any particular model's judgement.
 */

import type { NewSignal } from "@mind/core";
import type { ClassifierOutput } from "@mind/pipeline";

export interface ScenarioSignal {
  /** Offset from the scenario's start, in simulated hours. Determines receivedAt. */
  atHour: number;
  signal: Omit<NewSignal, "receivedAt" | "urgencyHint"> & { urgencyHint?: number | null };
  /** Pre-authored classification — skips the real classify() call. */
  classification: ClassifierOutput;
  /** Pre-authored draft body, or null to mean "no draft produced" (e.g. classifier not confident). */
  draftBody?: string | null;
  /**
   * Human narration for the demo script / brief walkthrough: what this
   * signal demonstrates and why it was authored this way.
   */
  narrative: string;
}

export interface PersonaScenario {
  id: string;
  displayName: string;
  /** One-paragraph pitch: what this persona proves about the product. */
  pitch: string;
  /**
   * Descriptive only — not read by the replay engine, which always loads
   * directions/demo/<id>/*.yaml. Lists the files here so a reader can find
   * them without searching the directions tree.
   */
  directionFiles: string[];
  /** Simulated start time. All atHour offsets are relative to this. */
  startAt: Date;
  signals: ScenarioSignal[];
}
