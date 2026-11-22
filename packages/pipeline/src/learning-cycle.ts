/**
 * One learning run, and the nightly schedule that triggers it.
 *
 * A run is: the rule-based loop (learning-loop.ts), then an optional model
 * insight (learning-insight.ts), recorded as a `learning.run` event. The
 * scheduler wakes every few minutes, and runs once per night when the clock is
 * inside the operator's window (core: learning-settings.ts, default 00:00 to
 * 04:00 local). An idle run also starts when nothing has happened for a while
 * and enough new decisions have come in since the last run (idleRunDue). A
 * manual run from the extension goes through the same function and does not use
 * up the night's scheduled run.
 */

import type { Db, LearningSettings } from "@mind/core";
import { events, isWithinLearningWindow, learningSettings, logger, newId } from "@mind/core";
import { desc, eq, sql } from "drizzle-orm";
import { generateLearningInsight } from "./learning-insight.js";
import type { DirectionProposal } from "./learning-loop.js";
import { runLearningLoop } from "./learning-loop.js";

/** The nightly window part of the settings. */
type LearningWindow = Pick<LearningSettings, "windowStart" | "windowEnd">;

export type LearningTrigger = "schedule" | "idle" | "manual";

export interface LearningRun {
  at: string;
  trigger: LearningTrigger;
  proposalCount: number;
  insight: boolean;
  /** Wall-clock runtime in ms. Absent on runs recorded before this field existed. */
  durationMs?: number;
}

let activeRuns = 0;

/** True while a learning run (manual or scheduled) is in progress in this process. */
export function isLearningRunning(): boolean {
  return activeRuns > 0;
}

/** How often the scheduler checks the clock. */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** A scheduled run is at most once per this long, so one night never runs twice. */
const MIN_HOURS_BETWEEN_SCHEDULED = 20;

export async function runLearningCycle(
  db: Db,
  trigger: LearningTrigger,
  now: Date = new Date(),
): Promise<{ proposals: DirectionProposal[]; insight: string | null }> {
  activeRuns++;
  const started = Date.now();
  try {
    return await runCycle(db, trigger, now, started);
  } finally {
    activeRuns--;
  }
}

async function runCycle(
  db: Db,
  trigger: LearningTrigger,
  now: Date,
  started: number,
): Promise<{ proposals: DirectionProposal[]; insight: string | null }> {
  const proposals = runLearningLoop(db, { now });
  const insight = await generateLearningInsight(proposals);
  const at = now.toISOString();

  if (insight) {
    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: "learning.insight",
        payload: JSON.stringify({ at, insight, proposalCount: proposals.length }),
      })
      .run();
  }
  const run: LearningRun = {
    at,
    trigger,
    proposalCount: proposals.length,
    insight: insight !== null,
    durationMs: Date.now() - started,
  };
  db.insert(events)
    .values({ id: newId(), actor: "system", kind: "learning.run", payload: JSON.stringify(run) })
    .run();
  return { proposals, insight };
}

/** The most recent run, optionally only scheduled ones. Null when none. */
export function lastLearningRun(db: Db, trigger?: LearningTrigger): LearningRun | null {
  const rows = db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.kind, "learning.run"))
    .orderBy(desc(events.at))
    .limit(50)
    .all();
  for (const row of rows) {
    try {
      const run = JSON.parse(row.payload) as LearningRun;
      if (!trigger || run.trigger === trigger) return run;
    } catch {
      /* skip an unreadable row */
    }
  }
  return null;
}

/** True when a scheduled run is due: inside the window and none in the last 20 hours. */
export function scheduledRunDue(db: Db, now: Date, settings: LearningWindow): boolean {
  if (!isWithinLearningWindow(now, settings)) return false;
  const last = lastLearningRun(db, "schedule");
  if (!last) return true;
  return now.getTime() - Date.parse(last.at) >= MIN_HOURS_BETWEEN_SCHEDULED * 3_600_000;
}

/** Events that are the operator's decisions, counted toward an idle run. */
const DECISION_KINDS = ["action.sent", "action.discarded", "signal.reclassified"];

/**
 * True when an idle run is due: the switch is on, no run in the last
 * minGapMinutes (any trigger), nothing happened for idleMinutes, and at least
 * minNewDecisions decisions came in since the last run. The loop's own
 * `learning.*` and `direction.proposal` events do not count as activity.
 */
export function idleRunDue(db: Db, now: Date, settings: LearningSettings): boolean {
  if (!settings.idleEnabled) return false;
  const last = lastLearningRun(db);
  if (last && now.getTime() - Date.parse(last.at) < settings.minGapMinutes * 60_000) return false;

  const newest = db
    .select({ at: sql<string | null>`max(${events.at})` })
    .from(events)
    .where(sql`${events.kind} not like 'learning.%' and ${events.kind} != 'direction.proposal'`)
    .get();
  if (newest?.at && now.getTime() - Date.parse(newest.at) < settings.idleMinutes * 60_000) {
    return false;
  }

  const since = last?.at ?? new Date(0).toISOString();
  const counted = db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sql`${events.kind} in (${sql.join(
        DECISION_KINDS.map((k) => sql`${k}`),
        sql`, `,
      )}) and ${events.at} > ${since}`,
    )
    .get();
  return (counted?.n ?? 0) >= settings.minNewDecisions;
}

export function startLearningLoop(db: Db, checkIntervalMs = CHECK_INTERVAL_MS): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date();
    const settings = learningSettings();
    const trigger: LearningTrigger | null = scheduledRunDue(db, now, settings)
      ? "schedule"
      : idleRunDue(db, now, settings)
        ? "idle"
        : null;
    if (!trigger || isLearningRunning()) return;
    running = true;
    try {
      await runLearningCycle(db, trigger, now);
    } catch (err) {
      logger.error({ err }, "learning loop: error");
    } finally {
      running = false;
    }
  };
  // Check once at startup too: a server started inside the window should not wait 10 minutes.
  void tick();
  return setInterval(() => void tick(), checkIntervalMs);
}
