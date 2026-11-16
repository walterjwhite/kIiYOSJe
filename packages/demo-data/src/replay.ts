/**
 * Replay engine.
 *
 * Loads a persona's Directions, then replays its signals through the real
 * ingest() pipeline — dedupe, match, decide, record all run for real. Only
 * classify() and draft() are skipped, via ingest()'s override parameter,
 * because this is demo data and must never call a real LLM.
 *
 * The "demo-email" adapter registered below declares canSend: true so the
 * send gates in decide()/ingest() are exercised for real — adapter capability,
 * autonomy, the kill switch, and escalateOn guards. Its send() method never
 * makes a network call; it just records that a send would have happened.
 *
 * After ingest, the engine simulates the operator's review decisions
 * (approve/discard) for any action the scenario marks as "overridden" in its
 * narrative, so /metrics, auto-disable, and the learning loop have real data
 * to react to — exactly as if a human had actually reviewed the Review panel
 * over those three weeks.
 */

import { eq, sql } from "drizzle-orm";
import { join } from "node:path";
import type { Db, NewSignal, Adapter, OutboundDraft, SendResult } from "@mind/core";
import { actions, events, directions, signals, newId, logger } from "@mind/core";
import { ingest, AdapterRegistry, loadDirections, runCheck, runLearningLoop } from "@mind/pipeline";
import type { PersonaScenario } from "./types.js";

export interface ReplayResult {
  personaId: string;
  signalsIngested: number;
  actionsDiscarded: number;
  actionsSent: number;
  learningProposals: number;
}

/**
 * A no-op adapter that declares full send capability so decide()'s gates
 * (adapter.capabilities.canSend, autonomy, kill switch, guards) are all
 * exercised for real. send() never performs a network call — it only
 * returns a synthetic externalId, exactly like a successful real send would,
 * so the recorded action.status transitions are indistinguishable from a
 * real run.
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

const DISCARD_ON_REPLAY = new Set<string>([
  // pm scenario — vendor-noise direction, 4 misses
  "pm-3", "pm-4", "pm-5", "pm-7",
  // devsecops scenario — dependabot direction, overrides that trip auto-disable
  "sec-3", "sec-4", "sec-7",
]);

/**
 * Actions the replay engine leaves untouched after ingest: these demonstrate
 * a guard blocking the autonomous send while the draft itself is correct and
 * genuinely awaiting human approval — ingest() itself decided not to send,
 * the replay engine just confirms that outcome rather than overriding it.
 */
const EXPECT_PROPOSED_NOT_SENT = new Set<string>([
  "eng-6b",  // escalateOn guard blocks send despite high confidence
  "sec-5b",  // same mechanism on a different direction
]);

export async function replayPersona(
  db: Db,
  scenario: PersonaScenario,
  directionsRoot: string,
): Promise<ReplayResult> {
  // Load only this persona's own directions — directionsRoot/demo/<persona id> —
  // never the shared directions/ tree, so the demo stays self-contained and
  // never depends on or interferes with any directions you've authored for
  // real use.
  loadDirections(db, join(directionsRoot, "demo", scenario.id));

  // MIND_SEND_ENABLED must be true during replay, or the global kill switch
  // alone would block every autonomous send and the demo could never show
  // the guard specifically doing the blocking.
  const previousSendEnabled = process.env["MIND_SEND_ENABLED"];
  process.env["MIND_SEND_ENABLED"] = "true";

  const adapters = new AdapterRegistry();
  adapters.register(new DemoEmailAdapter());

  try {
    for (const s of scenario.signals) {
      const receivedAt = new Date(scenario.startAt.getTime() + s.atHour * 60 * 60 * 1000);
      const signal: NewSignal = {
        ...s.signal,
        receivedAt,
        urgencyHint: s.signal.urgencyHint ?? null,
      };

      await ingest(db, signal, adapters, {
        classifierOutput: s.classification,
        draftBody: s.draftBody ?? null,
      });
    }
  } finally {
    if (previousSendEnabled === undefined) {
      delete process.env["MIND_SEND_ENABLED"];
    } else {
      process.env["MIND_SEND_ENABLED"] = previousSendEnabled;
    }
  }

  return resolveActionsAndLearn(db, scenario);
}

function resolveActionsAndLearn(db: Db, scenario: PersonaScenario): ReplayResult {
  let discarded = 0;
  let sent = 0;

  for (const s of scenario.signals) {
    const sig = db
      .select()
      .from(signals)
      .where(eq(signals.externalId, s.signal.externalId))
      .get();
    if (!sig) continue;

    const action = db
      .select()
      .from(actions)
      .where(eq(actions.signalId, sig.id))
      .get();
    if (!action) continue;

    if (EXPECT_PROPOSED_NOT_SENT.has(s.signal.externalId)) {
      if (action.status !== "proposed") {
        logger.warn(
          { externalId: s.signal.externalId, status: action.status },
          "demo seed: expected action to remain proposed (guard should have blocked autonomous send) but it did not — scenario authoring and engine behaviour disagree",
        );
      }
      continue;
    }

    if (action.status !== "proposed") continue; // already resolved autonomously by ingest()

    const now = new Date().toISOString();

    if (DISCARD_ON_REPLAY.has(s.signal.externalId)) {
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
        .set({ status: "sent", sentAt: now })
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

  // Deadlines already in the past relative to real wall-clock "now" are
  // promoted immediately rather than waiting for the next 60s tick.
  runCheck(db);

  // Generate learning-loop proposals now, mirroring a week of real operation.
  const proposals = runLearningLoop(db);

  return {
    personaId: scenario.id,
    signalsIngested: scenario.signals.length,
    actionsDiscarded: discarded,
    actionsSent: sent,
    learningProposals: proposals.length,
  };
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
    .where(
      sql`${signals.directionId} = ${directionId} and ${actions.status} = 'discarded'`,
    )
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
