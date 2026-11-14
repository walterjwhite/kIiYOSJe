/**
 * Top-level pipeline entry point.
 * Runs all steps for a single NewSignal and persists the result.
 * Returns the disposition for callers that want to log or count.
 */

import { eq } from "drizzle-orm";
import type { Db, NewSignal, SignalDisposition } from "@mind/core";
import { events, signals, thoughts, actions, logger, newId } from "@mind/core";
import { dedupeKey, isDuplicate } from "./dedupe.js";
import { normalize } from "./normalize.js";
import { matchSignal } from "./match.js";
import { classify } from "./classify.js";
import { draft } from "./draft.js";
import { decide } from "./decide.js";
import type { AdapterRegistry } from "./adapter-registry.js";

export async function ingest(
  db: Db,
  signal: NewSignal,
  adapters: AdapterRegistry,
): Promise<SignalDisposition | "duplicate"> {
  const key = dedupeKey(signal);
  const log = logger.child({ component: "pipeline", dedupeKey: key });

  // ── 1. Dedupe ────────────────────────────────────────────────────────────
  if (isDuplicate(db, key)) {
    log.debug("duplicate signal, dropping");
    return "duplicate";
  }

  // ── 2. Normalize ─────────────────────────────────────────────────────────
  const { body: normalizedBody } = normalize(signal.body);

  // ── 3. Match ─────────────────────────────────────────────────────────────
  const match = matchSignal(db, signal);

  // ── 4. Classify ──────────────────────────────────────────────────────────
  const classifierOut = await classify({
    signalBody: normalizedBody,
    sender: signal.sender,
    directionId: match?.direction.id ?? null,
    standard: match?.direction.standard ?? null,
  });

  // ── 5. Decide ─────────────────────────────────────────────────────────────
  let disposition: SignalDisposition;
  let createThought = false;
  let shouldSend = false;

  if (!match) {
    // No direction matched — escalate if addressed to me (all signals for now),
    // else file. For P0, escalate all unmatched.
    disposition = "escalated";
    createThought = true;
  } else {
    const dir = match.direction;
    const adapter = adapters.get(signal.adapter);
    const guards = evaluateGuards(dir, signal, db);

    const outcome = decide({
      posture: dir.posture as any,
      autonomy: dir.autonomy,
      adapterCanSend: adapter?.capabilities.canSend ?? false,
      confidence: classifierOut.confidence,
      confidenceMin: dir.confidenceMin,
      classifierOutput: classifierOut,
      guards,
    });

    disposition = outcome.disposition;
    shouldSend = "shouldSend" in outcome ? outcome.shouldSend : false;
    createThought =
      disposition === "promoted" || disposition === "escalated";
  }

  // ── 6. Record ─────────────────────────────────────────────────────────────
  const signalId = newId();
  const now = new Date().toISOString();

  db.insert(signals)
    .values({
      id: signalId,
      adapter: signal.adapter,
      externalId: signal.externalId,
      threadId: signal.threadId,
      sender: signal.sender,
      recipients: JSON.stringify(signal.recipients),
      kind: signal.kind,
      body: signal.body,
      receivedAt: signal.receivedAt.toISOString(),
      urgencyHint: signal.urgencyHint,
      disposition,
      directionId: match?.direction.id ?? null,
      dedupeKey: key,
    })
    .run();

  let thoughtId: string | undefined;
  if (createThought) {
    thoughtId = newId();
    db.insert(thoughts)
      .values({
        id: thoughtId,
        title: `Signal from ${signal.sender}`,
        body: normalizedBody,
        state: "seedling",
        directionId: match?.direction.id ?? null,
        nextAction: classifierOut.commitment,
      })
      .run();

    // Link signal → thought
    db.update(signals)
      .set({ thoughtId })
      .where(eq(signals.id, signalId))
      .run();
  }

  if (match && disposition === "absorbed") {
    const dir = match.direction;
    const draftBody = await draft({
      senderBody: normalizedBody,
      sender: signal.sender,
      standard: dir.standard,
      classifierOutput: classifierOut,
    });

    const actionId = newId();
    db.insert(actions)
      .values({
        id: actionId,
        thoughtId: thoughtId ?? null,
        signalId,
        kind: "reply",
        payload: JSON.stringify({
          to: [signal.sender],
          body: draftBody ?? "",
          threadId: signal.threadId,
          replyToExternalId: signal.externalId,
        }),
        status: "proposed",
        adapter: signal.adapter,
      })
      .run();
  }

  // Audit event
  db.insert(events)
    .values({
      id: newId(),
      actor: "system",
      kind: "signal.processed",
      payload: JSON.stringify({ signalId, disposition, directionId: match?.direction.id ?? null, confidence: classifierOut.confidence }),
    })
    .run();

  log.info({ disposition, directionId: match?.direction.id ?? null }, "signal processed");
  return disposition;
}

function evaluateGuards(
  dir: typeof import("@mind/core").directions.$inferSelect,
  signal: NewSignal,
  db: Db,
): { triggered: boolean } {
  if (!dir.guards) return { triggered: false };

  let guards: { maxPerThreadPerHour?: number; escalateOn?: string[] };
  try {
    guards = JSON.parse(dir.guards);
  } catch {
    return { triggered: false };
  }

  if (guards.escalateOn && guards.escalateOn.length > 0) {
    const bodyLower = signal.body.toLowerCase();
    for (const topic of guards.escalateOn) {
      if (bodyLower.includes(topic.toLowerCase())) {
        return { triggered: true };
      }
    }
  }

  return { triggered: false };
}
