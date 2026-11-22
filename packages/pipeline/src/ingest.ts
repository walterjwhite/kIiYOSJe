/**
 * Top-level pipeline entry point.
 * Runs all steps for a single NewSignal and persists the result.
 * Returns the full result: disposition plus the ids written, so callers can
 * act on more than "what happened" without re-querying the database.
 *
 * Three behaviours beyond PLAN §8 live here, all of them borrowed concepts
 * listed in references.md:
 *   - reply tracking (two-sided, so a send is not silently "absorbed")
 *   - commitment reconciliation (a later message replaces an earlier promise
 *     instead of competing with it)
 *   - disputed thoughts (confident but unanswerable becomes a Thought with the
 *     blocker attached, not a plausible wrong draft)
 */

import type {
  Commitment,
  Db,
  DirectionPosture,
  NewSignal,
  OutboundDraft,
  SignalDisposition,
} from "@mind/core";
import {
  actions,
  aiConfigured,
  autolinkSettings,
  type directions,
  events,
  globalSendEnabled,
  isOpenCommitment,
  logger,
  newCommitment,
  newId,
  operatorAddresses,
  sensitiveSettings,
  parseCommitment,
  sameCommitmentText,
  serializeCommitment,
  signals,
  supersedeCommitment,
  thoughts,
  verifyCommitment,
} from "@mind/core";
import { and, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { AdapterRegistry } from "./adapter-registry.js";
import { learningsForPrompt } from "./learnings.js";
import type { ClassifierOutput } from "./classify.js";
import { classify, unclassified } from "./classify.js";
import { decide } from "./decide.js";
import { dedupeKey, isDuplicate } from "./dedupe.js";
import { draft } from "./draft.js";
import { computeEscalateBy } from "./escalation.js";
import type { LinkOutput } from "./link.js";
import { chooseLink, LINK_PROMPT_VERSION, proposeLink } from "./link.js";
import { rankGoals } from "./link-candidates.js";
import { loadLinkContext } from "./link-context.js";
import { matchSignal } from "./match.js";
import type { ModelTrace } from "./model.js";
import { groundDeadline, isPlausibleDate } from "./deadlines.js";
import { MAX_DEFER_ATTEMPTS, deferSignal } from "./deferral.js";
import { INJECTION_HOLD, scanForInjection } from "./injection.js";
import { findSensitiveTopics } from "./sensitive.js";
import { normalize } from "./normalize.js";
import { ModelDeferral } from "./resilience.js";
import { transform } from "./transform.js";

type DirectionRow = typeof directions.$inferSelect;

export interface IngestOverrides {
  /** Skip the real classifier call and use this result instead. For tests and demo data. */
  classifierOutput?: ClassifierOutput;
  /** Skip the real drafter call and use this body instead (still subject to the same send gates). */
  draftBody?: string | null;
  /** Skip the real transform call and use this value instead. For tests and demo data. */
  transformedSummary?: string | null;
  /** Skip the real auto-link call and use this result instead. For tests. */
  linkOutput?: LinkOutput | null;
  /**
   * Process a signal that was held because the model was unavailable
   * (deferral.ts). The signal row already exists; this run fills it in instead of
   * inserting a second one. `attempt` is how many tries it has had so far.
   */
  resume?: { signalId: string; attempt: number };
}

export interface IngestResult {
  disposition: SignalDisposition | "duplicate";
  signalId: string | null;
  thoughtId: string | null;
  actionId: string | null;
  reason: string;
}

export async function ingest(
  db: Db,
  signal: NewSignal,
  adapters: AdapterRegistry,
  overrides?: IngestOverrides,
): Promise<IngestResult> {
  const key = dedupeKey(signal);
  const startedAt = performance.now();
  // Debug record of every model call this signal caused, and why any step
  // did not call one. Stored on the signal.processed event; no message text.
  const aiCalls: ModelTrace[] = [];
  const aiSkipped: Record<string, string> = {};
  const aiOn = aiConfigured();
  const log = logger.child({ component: "pipeline", dedupeKey: key });

  // ── 1. Dedupe ────────────────────────────────────────────────────────────
  if (!overrides?.resume && isDuplicate(db, key)) {
    log.debug("duplicate signal, dropping");
    return {
      disposition: "duplicate",
      signalId: null,
      thoughtId: null,
      actionId: null,
      reason: "already ingested",
    };
  }

  // ── 2. Normalize ─────────────────────────────────────────────────────────
  const { body: normalizedBody } = normalize(signal.body);

  const now = new Date().toISOString();

  // ── 2b. Reply tracking ───────────────────────────────────────────────────
  // Before anything else: if this signal is an inbound reply in a thread we
  // were waiting on, the wait is over. Recorded whether or not a Direction
  // matches, because it is a fact about the thread, not a decision.
  const replyAnsweredThread = markReplyReceived(db, signal, now);

  // ── 3. Match ─────────────────────────────────────────────────────────────
  const match = matchSignal(db, signal);

  // ── 4. Classify ──────────────────────────────────────────────────────────
  const classifyLearnings = learningsForPrompt("classify", match?.direction.id ?? null);
  const learningIds: { classify: string[]; draft: string[] } = {
    classify: classifyLearnings.ids,
    draft: [],
  };
  // Known injection phrasing is held for the operator before any model sees it.
  // No model call, no draft, no send: the signal becomes a Thought.
  const injection = scanForInjection(signal.subject, normalizedBody);
  if (injection) {
    aiSkipped["classify"] = "possible prompt injection, held for review";
    log.warn(
      { patterns: injection.patterns, categories: injection.categories },
      "possible prompt injection, held for review",
    );
  } else if (overrides?.classifierOutput) aiSkipped["classify"] = "override supplied";
  else if (!aiOn) aiSkipped["classify"] = "no AI provider configured";
  let modelOut: ClassifierOutput;
  try {
    modelOut =
      (injection ? INJECTION_HOLD : undefined) ??
      overrides?.classifierOutput ??
      (await classify({
        signalBody: normalizedBody,
        sender: signal.sender,
        standard: match?.direction.standard ?? null,
        receivedAt: signal.receivedAt,
        matchPrompt: match?.direction.matchPrompt ?? null,
        learnings: classifyLearnings.text,
        onTrace: (t) => aiCalls.push(t),
      }));
  } catch (err) {
    if (!(err instanceof ModelDeferral)) throw err;
    const attempt = overrides?.resume?.attempt ?? 0;
    if (attempt < MAX_DEFER_ATTEMPTS) {
      // The provider is down or slow. That says nothing about the message, so it
      // is stored and tried again later, never absorbed and never lost.
      return deferSignal(db, {
        signal,
        normalizedBody,
        dedupeKey: key,
        directionId: match?.direction.id ?? null,
        reason: err.reason,
        attempt: attempt + 1,
        ...(overrides?.resume ? { existingSignalId: overrides.resume.signalId } : {}),
      });
    }
    // Out of tries: it must not wait for ever. Zero confidence never absorbs, so
    // the operator sees it, and the event says why.
    aiSkipped["classify"] = `model unavailable after ${attempt} tries (${err.reason})`;
    modelOut = unclassified();
  }

  // ── 4a. Ground the dates ─────────────────────────────────────────────────
  // A date read from the message ("by Friday", resolved against when it arrived)
  // wins over the model's. A model date that is in the past or years away is
  // dropped, not trusted (deadlines.ts).
  const deadline = injection
    ? { value: modelOut.escalateBy, source: null, droppedModelDate: false }
    : groundDeadline(
        `${signal.subject ?? ""}\n${normalizedBody}`,
        signal.receivedAt,
        modelOut.escalateBy,
      );
  const classifierOut: ClassifierOutput = {
    ...modelOut,
    escalateBy: deadline.value,
    commitmentDueDate:
      modelOut.commitmentDueDate &&
      isPlausibleDate(new Date(modelOut.commitmentDueDate), signal.receivedAt)
        ? modelOut.commitmentDueDate
        : null,
  };

  // ── 4b. Compute escalation deadline ──────────────────────────────────────
  const escalateBy = computeEscalateBy(classifierOut, signal.receivedAt);

  // ── 4d. Transform (optional display rewrite, never changes routing) ──────
  if (injection) aiSkipped["transform"] = "possible prompt injection, held for review";
  else if (overrides?.transformedSummary !== undefined)
    aiSkipped["transform"] = "override supplied";
  else if (!match?.direction.transformPrompt)
    aiSkipped["transform"] = "direction has no transformPrompt";
  else if (!aiOn) aiSkipped["transform"] = "no AI provider configured";
  const transformedSummary = injection
    ? null
    : overrides?.transformedSummary !== undefined
      ? overrides.transformedSummary
      : match?.direction.transformPrompt
        ? await transform({
            signalBody: normalizedBody,
            subject: signal.subject ?? null,
            sender: signal.sender,
            transformPrompt: match.direction.transformPrompt,
            recipients: signal.recipients,
            onTrace: (t) => aiCalls.push(t),
          })
        : null;

  const signalId = overrides?.resume?.signalId ?? newId();

  // ── 4c. Commitment reconciliation ────────────────────────────────────────
  // One open commitment per thread. A later message either verifies it, or
  // replaces it — and the replacement keeps the old state in previousStates.
  // The failure this prevents: two competing dates, two reminders, no way to
  // tell which promise is dead.
  const open = signal.threadId ? findOpenCommitmentInThread(db, signal.threadId) : null;

  let commitment: Commitment | null = null;
  let commitmentThoughtId: string | null = null;
  let commitmentEvent: { kind: string; payload: Record<string, unknown> } | null = null;

  if (classifierOut.commitment) {
    const incoming = newCommitment({
      text: classifierOut.commitment,
      dueDate: classifierOut.commitmentDueDate ?? escalateBy,
      confidence: classifierOut.confidence,
      sourceSignalId: signalId,
      at: now,
    });

    if (!open) {
      commitment = incoming;
    } else if (
      sameCommitmentText(open.commitment.text, incoming.text) &&
      (incoming.dueDate === null || incoming.dueDate === open.commitment.dueDate)
    ) {
      commitment = verifyCommitment(open.commitment, now);
      commitmentThoughtId = open.thoughtId;
      commitmentEvent = {
        kind: "commitment.verified",
        payload: {
          thoughtId: open.thoughtId,
          signalId,
          text: commitment.text,
          dueDate: commitment.dueDate,
        },
      };
    } else {
      commitment = supersedeCommitment(open.commitment, incoming, now);
      commitmentThoughtId = open.thoughtId;
      commitmentEvent = {
        kind: "commitment.superseded",
        payload: {
          thoughtId: open.thoughtId,
          signalId,
          previousText: open.commitment.text,
          previousDueDate: open.commitment.dueDate,
          text: commitment.text,
          dueDate: commitment.dueDate,
        },
      };
    }
  }

  // ── 4e. Sensitive topics ─────────────────────────────────────────────────
  // The operator's own list (legal, financial, health, anything they add). A
  // topic in the message, or a classifier tag naming one, keeps it out of
  // absorption. Names only are recorded, never text.
  const sensitive = injection
    ? []
    : findSensitiveTopics(
        `${signal.subject ?? ""}\n${normalizedBody}`,
        classifierOut.sensitiveTopics,
        sensitiveSettings(),
      );

  // ── 5. Decide ─────────────────────────────────────────────────────────────
  let disposition: SignalDisposition;
  let disputed = false;
  let shouldSend = false;
  let reason = match ? "matched" : "no specific direction";

  if (!match) {
    // No direction and no fallback — this shouldn't happen once ensureFallbackDirection
    // has run, but be safe: escalate so nothing is silently dropped.
    disposition = "escalated";
  } else {
    const dir = match.direction;
    const adapter = adapters.get(signal.adapter);
    const guards = evaluateGuards(dir, signal, db);
    if (guards.triggered) reason = "guard triggered";

    const outcome = decide({
      posture: dir.posture as DirectionPosture,
      autonomy: dir.autonomy,
      adapterCanSend: adapter?.capabilities.canSend ?? false,
      confidence: classifierOut.confidence,
      confidenceMin: dir.confidenceMin,
      classifierOutput: classifierOut,
      guards,
    });

    disposition = outcome.disposition;
    shouldSend = "shouldSend" in outcome ? outcome.shouldSend : false;
    if (outcome.disposition === "escalated" && outcome.disputed) {
      disputed = true;
      reason = classifierOut.answerBlocker ?? "needs my judgement";
    }
    if (injection) reason = "possible prompt injection";
    else if (sensitive.length > 0 && disposition === "absorbed") {
      // A sensitive topic is never absorbed, drafted, or sent. Applied after
      // decide() so the send gates themselves are untouched.
      disposition = "escalated";
      shouldSend = false;
      reason = `sensitive topic: ${sensitive.join(", ")}`;
    }
  }

  // ── 6. Record ─────────────────────────────────────────────────────────────
  // The Thought is written first: signals.thought_id is a real foreign key.
  let thoughtId: string | null = null;

  if (commitmentThoughtId) {
    const existing = db.select().from(thoughts).where(eq(thoughts.id, commitmentThoughtId)).get();

    if (existing) {
      thoughtId = existing.id;
      db.update(thoughts)
        .set({
          ...(commitment
            ? {
                commitment: serializeCommitment(commitment),
                nextAction: commitment.text,
                reviewAt: commitment.dueDate,
                escalateBy: commitment.dueDate,
              }
            : {}),
          ...(disputed ? { state: "disputed", disputedReason: classifierOut.answerBlocker } : {}),
          updatedAt: now,
        })
        .where(eq(thoughts.id, thoughtId))
        .run();
    }
  }

  if (
    !thoughtId &&
    (disposition === "promoted" || disposition === "escalated" || commitment !== null)
  ) {
    thoughtId = newId();
    db.insert(thoughts)
      .values({
        id: thoughtId,
        title: buildThoughtTitle(classifierOut, signal.sender),
        body: normalizedBody,
        state: disputed ? "disputed" : disposition === "escalated" ? "active" : "seedling",
        directionId: match?.direction.id ?? null,
        nextAction: commitment?.text ?? classifierOut.commitment,
        reviewAt: commitment?.dueDate ?? null,
        escalateBy: commitment?.dueDate ?? escalateBy,
        commitment: commitment ? serializeCommitment(commitment) : null,
        disputedReason: disputed ? classifierOut.answerBlocker : null,
      })
      .run();
  }

  let actionId: string | null = null;

  const row = {
    adapter: signal.adapter,
    account: signal.account ?? null,
    externalId: signal.externalId,
    threadId: signal.threadId,
    sender: signal.sender,
    recipients: JSON.stringify(signal.recipients),
    cc: signal.cc && signal.cc.length > 0 ? JSON.stringify(signal.cc) : null,
    bcc: signal.bcc && signal.bcc.length > 0 ? JSON.stringify(signal.bcc) : null,
    kind: signal.kind,
    subject: signal.subject ?? null,
    body: normalizedBody,
    htmlBody: signal.htmlBody ?? null,
    transformedSummary,
    receivedAt: signal.receivedAt.toISOString(),
    urgencyHint: signal.urgencyHint,
    disposition,
    directionId: match?.direction.id ?? null,
    thoughtId,
    signalKind: classifierOut.signalKind,
    escalateBy,
    dedupeKey: key,
  };
  if (overrides?.resume) {
    // The row was stored when the signal was deferred; fill it in.
    db.update(signals).set(row).where(eq(signals.id, signalId)).run();
  } else {
    db.insert(signals)
      .values({ id: signalId, ...row })
      .run();
  }

  if (commitmentEvent) {
    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: commitmentEvent.kind,
        payload: JSON.stringify(commitmentEvent.payload),
      })
      .run();
  }

  if (replyAnsweredThread) {
    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: "reply.received",
        payload: JSON.stringify({
          threadId: replyAnsweredThread,
          signalId,
          sender: signal.sender,
        }),
      })
      .run();
  }

  // A calendar event is not a message: there is no one to reply to, and the
  // operator has usually already answered the invitation in another client.
  // Absorbing one records it and stops: no draft, no Queue entry.
  if (match && disposition === "absorbed" && signal.kind !== "event") {
    const dir = match.direction;
    const draftLearnings = learningsForPrompt("draft", dir.id);
    learningIds.draft = draftLearnings.ids;
    const draftBody =
      overrides?.draftBody !== undefined
        ? overrides.draftBody
        : await draft({
            senderBody: normalizedBody,
            sender: signal.sender,
            standard: dir.standard,
            classifierOutput: classifierOut,
            responsePrompt: dir.responsePrompt,
            learnings: draftLearnings.text,
            onTrace: (t) => aiCalls.push(t),
          });
    if (overrides?.draftBody !== undefined) aiSkipped["draft"] = "override supplied";
    else if (!aiOn) aiSkipped["draft"] = "no AI provider configured";

    // A null draft means the drafter is not configured: file the signal
    // instead of proposing an empty message (same rule as the monorepo).
    if (draftBody === null || draftBody.trim() === "") {
      disposition = "filed";
      reason = "drafter not configured";
      db.update(signals).set({ disposition }).where(eq(signals.id, signalId)).run();
    } else {
      actionId = newId();
      const outbound: OutboundDraft = {
        to: [signal.sender],
        body: draftBody,
        threadId: signal.threadId,
        replyToExternalId: signal.externalId,
      };

      db.insert(actions)
        .values({
          id: actionId,
          thoughtId: thoughtId ?? null,
          signalId,
          kind: "reply",
          payload: JSON.stringify(outbound),
          status: "proposed",
          adapter: signal.adapter,
          account: signal.account ?? null,
        })
        .run();

      // Autonomous send (PLAN §7). The gates were evaluated in decide(); the
      // kill switch is re-checked here so `mind pause` takes effect even if it
      // was engaged while the draft was being generated. An empty draft is
      // never sent: it stays proposed for the operator.
      const sender = adapters.get(signal.adapter);
      if (shouldSend && sender?.send && outbound.body.trim() !== "" && globalSendEnabled()) {
        try {
          const result = await sender.send(outbound);
          db.update(actions)
            .set({ status: "sent", sentAt: now })
            .where(eq(actions.id, actionId))
            .run();
          // A send is not absorption until the other side answers: start the
          // clock the two-sided metric is computed from.
          markThreadAwaitingReply(db, signal.threadId, now, thoughtId);
          db.insert(events)
            .values({
              id: newId(),
              actor: "system",
              kind: "action.sent",
              payload: JSON.stringify({
                actionId,
                externalId: result.externalId,
                autonomous: true,
                directionId: dir.id,
                awaitingReply: signal.threadId !== null,
              }),
            })
            .run();
        } catch (err) {
          db.update(actions).set({ status: "failed" }).where(eq(actions.id, actionId)).run();
          db.insert(events)
            .values({
              id: newId(),
              actor: "system",
              kind: "action.failed",
              payload: JSON.stringify({
                actionId,
                autonomous: true,
                error: String(err),
              }),
            })
            .run();
          log.error({ err, actionId }, "autonomous send failed");
        }
      }
    }
  }

  // ── 6b. Auto-link to a Goal ──────────────────────────────────────────────
  // A signal that will show up in the Queue may belong to something the
  // operator is already focused on. Only a confident match is linked; the
  // link is an event, so it is explainable and can be undone.
  const autolink = autolinkSettings();
  const queued = disposition === "promoted" || disposition === "escalated" || actionId !== null;
  if (injection) aiSkipped["link"] = "possible prompt injection, held for review";
  if (queued && autolink.enabled && !injection) {
    // Shortlist the best few goals first, so the model sees three choices and
    // the operator's earlier manual links, not every goal. A message that
    // resembles no goal never reaches the model.
    const context = loadLinkContext(db, { id: signalId, threadId: signal.threadId ?? null });
    const goals = context.goals;
    const candidates = rankGoals(
      {
        sender: signal.sender,
        subject: signal.subject ?? null,
        body: normalizedBody,
        threadGoalIds: context.threadGoalIds,
      },
      goals,
      context.exemplars,
    );
    const overridden = overrides?.linkOutput !== undefined;
    if (goals.length === 0) aiSkipped["link"] = "no goals to link to";
    else if (!overridden && !aiOn) aiSkipped["link"] = "no AI provider configured";
    else if (!overridden && candidates.length === 0)
      aiSkipped["link"] = "no goal resembles the message";
    const proposed = overridden
      ? (overrides?.linkOutput ?? null)
      : await proposeLink({
          signalBody: normalizedBody,
          sender: signal.sender,
          subject: signal.subject ?? null,
          candidates,
          onTrace: (t) => aiCalls.push(t),
        });
    // The model may only pick from what it was shown.
    const link = chooseLink(
      proposed,
      overridden ? goals : candidates.map((c) => c.goal),
      autolink.threshold,
    );
    if (link) {
      db.update(signals).set({ thoughtId: link.thoughtId }).where(eq(signals.id, signalId)).run();
      db.insert(events)
        .values({
          id: newId(),
          actor: "system",
          kind: "signal.thought_linked",
          payload: JSON.stringify({
            signalId,
            thoughtId: link.thoughtId,
            previousThoughtId: thoughtId ?? null,
            auto: true,
            confidence: link.confidence,
            threshold: autolink.threshold,
            promptVersion: LINK_PROMPT_VERSION,
            candidateIds: candidates.map((c) => c.goal.id),
          }),
        })
        .run();
    }
  } else if (queued) {
    aiSkipped["link"] = "auto-link is turned off";
  }

  // Audit event — carries the reasoning, not just the outcome, so the Journal
  // can answer "why did it do that" without a second lookup.
  db.insert(events)
    .values({
      id: newId(),
      actor: "system",
      kind: "signal.processed",
      payload: JSON.stringify({
        signalId,
        adapter: signal.adapter,
        account: signal.account ?? null,
        disposition,
        reason,
        directionId: match?.direction.id ?? null,
        matchedBy: match
          ? match.isFallback
            ? "fallback"
            : `scope:${match.direction.scopeKind}`
          : null,
        confidence: classifierOut.confidence,
        intent: classifierOut.intent,
        signalKind: classifierOut.signalKind,
        urgency: classifierOut.urgency,
        answerable: classifierOut.answerable,
        answerBlocker: classifierOut.answerBlocker,
        sensitiveTopics: classifierOut.sensitiveTopics,
        disputed,
        commitment: commitment?.text ?? classifierOut.commitment,
        commitmentDueDate: commitment?.dueDate ?? null,
        commitmentStatus: commitment?.status ?? null,
        commitmentSuperseded: commitmentEvent?.kind === "commitment.superseded",
        escalateBy,
        deadlineSource: deadline.source,
        deadlineDropped: deadline.droppedModelDate,
        sensitive,
        injection: injection
          ? { risk: injection.risk, patterns: injection.patterns, categories: injection.categories }
          : null,
        thoughtId,
        actionId,
        replyReceivedFrom: replyAnsweredThread ? signal.sender : null,
        learnings: learningIds,
        ai: {
          configured: aiOn,
          calls: aiCalls,
          skipped: aiSkipped,
          modelMs: aiCalls.reduce((sum, c) => sum + c.durationMs, 0),
          totalMs: Math.round(performance.now() - startedAt),
        },
      }),
    })
    .run();

  log.info(
    {
      disposition,
      directionId: match?.direction.id ?? null,
      signalKind: classifierOut.signalKind,
      answerable: classifierOut.answerable,
      disputed,
      escalateBy,
    },
    "signal processed",
  );
  return {
    disposition,
    signalId,
    thoughtId: thoughtId ?? null,
    actionId,
    reason,
  };
}

function buildThoughtTitle(classifierOut: ClassifierOutput, sender: string): string {
  if (classifierOut.intent && classifierOut.intent !== "unclassified — no API key or LLM error") {
    return `${classifierOut.intent} — ${sender}`;
  }
  return `Signal from ${sender}`;
}

/**
 * The newest open commitment in this thread, if any. Reads from the Thought,
 * but uses the Signal rows to establish thread membership, so a thread that
 * spans several Thoughts still resolves chronologically.
 */
export function findOpenCommitmentInThread(
  db: Db,
  threadId: string,
): { thoughtId: string; commitment: Commitment } | null {
  const rows = db
    .select({
      thoughtId: thoughts.id,
      commitment: thoughts.commitment,
      receivedAt: signals.receivedAt,
    })
    .from(signals)
    .innerJoin(thoughts, eq(thoughts.id, signals.thoughtId))
    .where(and(eq(signals.threadId, threadId), isNotNull(thoughts.commitment)))
    .orderBy(desc(signals.receivedAt))
    .limit(20)
    .all();

  for (const row of rows) {
    if (!row.thoughtId) continue;
    const commitment = parseCommitment(row.commitment);
    if (commitment && isOpenCommitment(commitment)) {
      return { thoughtId: row.thoughtId, commitment };
    }
  }
  return null;
}

/**
 * An inbound message from someone other than the operator closes every
 * outstanding wait in that thread. Returns the thread id when it did.
 */
function markReplyReceived(db: Db, signal: NewSignal, at: string): string | null {
  if (!signal.threadId) return null;
  const self = new Set(operatorAddresses().map((a) => a.toLowerCase()));
  if (self.has(signal.sender.toLowerCase())) return null;

  const pending = db
    .select({ id: signals.id })
    .from(signals)
    .where(
      and(
        eq(signals.threadId, signal.threadId),
        isNotNull(signals.awaitingReplyAt),
        isNull(signals.replyReceivedAt),
      ),
    )
    .all();
  if (pending.length === 0) return null;

  db.update(signals)
    .set({ replyReceivedAt: at })
    .where(
      and(
        eq(signals.threadId, signal.threadId),
        isNotNull(signals.awaitingReplyAt),
        isNull(signals.replyReceivedAt),
      ),
    )
    .run();

  db.update(thoughts)
    .set({ awaitingReplyAt: null })
    .where(
      and(
        isNotNull(thoughts.awaitingReplyAt),
        sql`${thoughts.id} in (select thought_id from signals where thread_id = ${signal.threadId} and thought_id is not null)`,
      ),
    )
    .run();

  return signal.threadId;
}

/** Called after an outbound reply (autonomous or approved) actually goes out. */
export function markThreadAwaitingReply(
  db: Db,
  threadId: string | null,
  at: string,
  thoughtId?: string | null,
): void {
  if (threadId) {
    db.update(signals).set({ awaitingReplyAt: at }).where(eq(signals.threadId, threadId)).run();
  }
  if (thoughtId) {
    db.update(thoughts).set({ awaitingReplyAt: at }).where(eq(thoughts.id, thoughtId)).run();
  }
}

export function evaluateGuards(
  dir: DirectionRow,
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

  if (guards.maxPerThreadPerHour != null && signal.threadId != null) {
    const oneHourAgo = new Date(signal.receivedAt.getTime() - 60 * 60 * 1000).toISOString();
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        and(
          eq(signals.threadId, signal.threadId),
          or(eq(signals.disposition, "absorbed"), eq(signals.disposition, "new")),
          gte(signals.receivedAt, oneHourAgo),
        ),
      )
      .get();

    const count = result?.count ?? 0;
    if (count >= guards.maxPerThreadPerHour) {
      return { triggered: true };
    }
  }

  return { triggered: false };
}
