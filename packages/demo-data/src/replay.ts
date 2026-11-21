/**
 * Replay engine.
 *
 * Every signal goes through the real ingest() pipeline with no overrides:
 * dedupe, match, classify (a real model call), draft (a real model call),
 * decide, and record all run exactly as they would for a real signal. The
 * only thing simulated is the operator's reaction to historical-era actions,
 * and that simulation is a general heuristic applied to whatever the model
 * actually decided — never a lookup keyed by signal ID, because that would
 * mean the "decision" was mine, not the model's.
 *
 * Live-era signals are left completely alone after ingest(). Whatever
 * ingest() produced — escalated, promoted, a proposed draft, or (if the
 * configured direction allows it and the gates are open) an autonomous send
 * — is exactly what appears in the extension. The operator reacts to those
 * for real, through Review, same as production.
 */

import { eq, sql } from "drizzle-orm";
import { join } from "node:path";
import type { Db, NewSignal, Adapter, OutboundDraft, SendResult } from "@mind/core";
import { actions, events, directions, signals, newId, logger } from "@mind/core";
import { ingest, AdapterRegistry, loadDirections, runCheck, runLearningLoop } from "@mind/pipeline";
import type { PersonaScenario, ScenarioSignal } from "./types.js";

export interface ReplayResult {
  personaId: string;
  signalsIngested: number;
  historicalResolved: { sent: number; discarded: number };
  liveLeftProposed: number;
  learningProposals: number;
}

/**
 * A no-op adapter that declares full send capability so decide()'s gates
 * (adapter.capabilities.canSend, autonomy, kill switch, guards) are all
 * exercised for real. send() never performs a network call — it only
 * returns a synthetic externalId, exactly like a successful real send would.
 */
class DemoEmailAdapter implements Adapter {
  readonly id = "demo-email";
  readonly capabilities = { canSend: true, canStream: false };
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_draft: OutboundDraft): Promise<SendResult> {
    return { externalId: `demo-sent-${newId()}` };
  }
}

export async function replayPersona(
  db: Db,
  scenario: PersonaScenario,
  directionsRoot: string,
): Promise<ReplayResult> {
  // Load only this persona's own directions — never the shared directions/
  // tree — so the demo stays self-contained and never depends on or
  // interferes with anything you've authored for real use.
  loadDirections(db, join(directionsRoot, "demo", scenario.id));

  // MIND_SEND_ENABLED must be true during replay, or the global kill switch
  // alone would block every autonomous send and no direction's autonomy:send
  // setting could ever be exercised, historical or live.
  const previousSendEnabled = process.env["MIND_SEND_ENABLED"];
  process.env["MIND_SEND_ENABLED"] = "true";

  const adapters = new AdapterRegistry();
  adapters.register(new DemoEmailAdapter());

  const historicalSignals: ScenarioSignal[] = [];
  const liveSignals: ScenarioSignal[] = [];

  try {
    for (const s of scenario.signals) {
      const receivedAt =
        s.era === "live"
          ? new Date() // live signals land "now", regardless of the historical startAt
          : new Date(scenario.startAt.getTime() + s.atHour * 60 * 60 * 1000);
      const signal: NewSignal = {
        ...s.signal,
        receivedAt,
        urgencyHint: s.signal.urgencyHint ?? null,
      };

      // No overrides — classify() and draft() are called for real.
      await ingest(db, signal, adapters);

      if (s.era === "historical") historicalSignals.push(s);
      else liveSignals.push(s);
    }
  } finally {
    if (previousSendEnabled === undefined) {
      delete process.env["MIND_SEND_ENABLED"];
    } else {
      process.env["MIND_SEND_ENABLED"] = previousSendEnabled;
    }
  }

  const resolved = resolveHistoricalActions(db, historicalSignals);
  const liveLeftProposed = countProposed(db, liveSignals);

  // Deadlines already in the past relative to real wall-clock "now" are
  // promoted immediately rather than waiting for the next tick.
  runCheck(db);

  // Generate learning-loop proposals from whatever override history the
  // historical era actually produced.
  const proposals = runLearningLoop(db);

  return {
    personaId: scenario.id,
    signalsIngested: scenario.signals.length,
    historicalResolved: resolved,
    liveLeftProposed,
    learningProposals: proposals.length,
  };
}

/**
 * Simulates a plausible operator reaction to each historical-era action that
 * ingest() left `proposed`. The heuristic looks only at information a real
 * operator would have had — the draft's own confidence-adjacent signals
 * aren't visible to this function; it uses the same signal data the system
 * recorded, nothing authored in advance:
 *
 *   - discard if the signal carried any sensitive topic (budget, headcount,
 *     legal, security, scope change, etc.) — a careful operator does not
 *     wave these through regardless of how the draft reads
 *   - discard roughly 1 in 4 of everything else, pseudo-randomly but
 *     deterministically (seeded from the signal's id), standing in for the
 *     ordinary rate at which a human improves on an early draft
 *   - approve (simulate send) otherwise
 *
 * This is deliberately coarse. It is not meant to be a good reviewer — it
 * is meant to produce a believable mix of approvals and overrides so the
 * auto-disable rule and the learning loop have real data to react to,
 * without encoding "what the model will say" anywhere.
 */
function resolveHistoricalActions(
  db: Db,
  historicalSignals: ScenarioSignal[],
): { sent: number; discarded: number } {
  let sent = 0;
  let discarded = 0;

  for (const s of historicalSignals) {
    const sig = db.select().from(signals).where(eq(signals.externalId, s.signal.externalId)).get();
    if (!sig) continue;

    const action = db.select().from(actions).where(eq(actions.signalId, sig.id)).get();
    if (!action || action.status !== "proposed") continue; // nothing to resolve, or already sent autonomously

    const shouldDiscard = decideSimulatedReaction(sig.body, sig.id);

    if (shouldDiscard) {
      db.update(actions).set({ status: "discarded" }).where(eq(actions.id, action.id)).run();
      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "action.discarded",
          payload: JSON.stringify({ actionId: action.id, demoReplay: true }),
        })
        .run();
      discarded++;
      maybeAutoDisable(db, sig.directionId);
    } else {
      db.update(actions)
        .set({ status: "sent", sentAt: new Date().toISOString() })
        .where(eq(actions.id, action.id))
        .run();
      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "action.sent",
          payload: JSON.stringify({ actionId: action.id, demoReplay: true }),
        })
        .run();
      sent++;
    }
  }

  return { sent, discarded };
}

const SENSITIVE_PATTERNS = [
  "budget",
  "headcount",
  "legal",
  "scope change",
  "critical",
  "cve score 9",
  "cve score 10",
  "breach",
  "exploit",
  "unauthorized access",
];

function decideSimulatedReaction(body: string, seedId: string): boolean {
  const lower = body.toLowerCase();
  if (SENSITIVE_PATTERNS.some((p) => lower.includes(p))) return true;

  // Deterministic pseudo-random ~25% discard rate, seeded from the signal id
  // so repeated seeding of the same data is reproducible.
  let hash = 0;
  for (let i = 0; i < seedId.length; i++) {
    hash = (hash * 31 + seedId.charCodeAt(i)) >>> 0;
  }
  return hash % 4 === 0;
}

function countProposed(db: Db, liveSignals: ScenarioSignal[]): number {
  let count = 0;
  for (const s of liveSignals) {
    const sig = db.select().from(signals).where(eq(signals.externalId, s.signal.externalId)).get();
    if (!sig) continue;
    const action = db.select().from(actions).where(eq(actions.signalId, sig.id)).get();
    if (action?.status === "proposed") count++;
  }
  return count;
}

/** Mirrors the same >20%-override-rate rule as POST /actions/:id/discard. */
function maybeAutoDisable(db: Db, directionId: string | null): void {
  if (!directionId) return;

  const dir = db.select().from(directions).where(eq(directions.id, directionId)).get();
  if (!dir || !dir.enabled) return;

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(actions)
    .innerJoin(signals, eq(actions.signalId, signals.id))
    .where(
      sql`${signals.directionId} = ${directionId} and ${actions.status} in ('proposed','sent','discarded')`,
    )
    .get();

  const total = totalRow?.count ?? 0;
  if (total < 5) return;

  const discardedRow = db
    .select({ count: sql<number>`count(*)` })
    .from(actions)
    .innerJoin(signals, eq(actions.signalId, signals.id))
    .where(sql`${signals.directionId} = ${directionId} and ${actions.status} = 'discarded'`)
    .get();

  const discardedCount = discardedRow?.count ?? 0;
  const overrideRate = discardedCount / total;
  if (overrideRate <= 0.2) return;

  db.update(directions)
    .set({ enabled: false, updatedAt: new Date().toISOString() })
    .where(eq(directions.id, directionId))
    .run();

  db.insert(events)
    .values({
      id: newId(),
      actor: "system",
      kind: "direction.auto-disabled",
      payload: JSON.stringify({
        directionId,
        overrideRate,
        total,
        discarded: discardedCount,
        demoReplay: true,
      }),
    })
    .run();

  logger.warn({ directionId, overrideRate, total }, "demo: direction auto-disabled during replay");
}
