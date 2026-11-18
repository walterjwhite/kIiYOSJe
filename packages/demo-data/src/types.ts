/**
 * Demo scenario types.
 *
 * A persona is a slice of someone's inbox pressure. Every signal here is
 * fake data — a synthetic sender, body, and timestamp — but nothing about
 * how the system responds to it is scripted. classify() and draft() always
 * call the real, configured model (ollama by default, or whatever provider
 * is set in ~/.config/kIiYOSJe/mind/ai.json). The decision is probabilistic because
 * the model is probabilistic; that is the entire point of using one instead
 * of a lookup table.
 *
 * Signals are split into two eras:
 *   - historical: replayed and then given a simulated operator reaction
 *     (approve/discard), so the system looks lived-in — directions with
 *     real override rates, maybe one already auto-disabled, a pending
 *     learning-loop proposal — before you ever open the extension.
 *   - live: replayed and left exactly as ingest() produced them. Nothing
 *     resolves these. They sit in Review for you to act on yourself.
 */

import type { NewSignal } from "@mind/core";

export interface ScenarioSignal {
  /**
   * Offset from the scenario's start, in simulated hours. Determines
   * receivedAt for historical-era signals. Ignored for live-era signals,
   * which always land at real wall-clock "now" so their deadlines and
   * "today" framing in the brief are actually current.
   */
  atHour: number;
  signal: Omit<NewSignal, "receivedAt" | "urgencyHint"> & { urgencyHint?: number | null };
  /**
   * historical: replayed, then auto-resolved by a general heuristic (not a
   * per-signal script) so override/auto-disable/learning-loop data exists.
   * live: replayed and left untouched for the operator to act on.
   */
  era: "historical" | "live";
  /**
   * What this signal is designed to exercise, for a human reading the
   * scenario file. Not predictive of the actual outcome — the model decides
   * that — and not shown anywhere in the product; documentation only.
   */
  intent: string;
}

/** The flat persona shape both trees expose for `mind demo`-style seeding. */
export interface DemoSignal {
  adapter: string;
  externalId: string;
  sender: string;
  threadId?: string;
  kind: string;
  body: string;
  /** Age of the signal in minutes, derived from the scenario's `atHour`. */
  minutesAgo: number;
}

export interface PersonaScenario {
  id: string;
  displayName: string;
  /** One-paragraph pitch: what this persona is meant to exercise. */
  pitch: string;
  /**
   * Descriptive only — not read by the replay engine, which always loads
   * directions/demo/<id>/*.yaml. Lists the files here so a reader can find
   * them without searching the directions tree.
   */
  directionFiles: string[];
  /** Simulated start time for the historical era. Live signals land "now". */
  startAt: Date;
  signals: ScenarioSignal[];
}
