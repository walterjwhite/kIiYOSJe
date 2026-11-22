/**
 * One learning run, and the nightly schedule that triggers it.
 *
 * A run is: the rule-based loop (learning-loop.ts), then an optional model
 * insight (learning-insight.ts), recorded as a `learning.run` event. The
 * scheduler wakes every few minutes, and runs once per night when the clock is
 * inside the operator's window (core: learning-settings.ts, default 00:00 to
 * 04:00 local). A manual run from the extension goes through the same function
 * and does not use up the night's scheduled run.
 */

import type { Db, LearningSettings } from "@mind/core";
import { events, isWithinLearningWindow, learningSettings, logger, newId } from "@mind/core";
import { desc, eq } from "drizzle-orm";
import { generateLearningInsight } from "./learning-insight.js";
import type { DirectionProposal } from "./learning-loop.js";
import { runLearningLoop } from "./learning-loop.js";

export type LearningTrigger = "schedule" | "manual";

export interface LearningRun {
  at: string;
  trigger: LearningTrigger;
  proposalCount: number;
  insight: boolean;
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
export function scheduledRunDue(db: Db, now: Date, settings: LearningSettings): boolean {
  if (!isWithinLearningWindow(now, settings)) return false;
  const last = lastLearningRun(db, "schedule");
  if (!last) return true;
  return now.getTime() - Date.parse(last.at) >= MIN_HOURS_BETWEEN_SCHEDULED * 3_600_000;
}

export function startLearningLoop(db: Db, checkIntervalMs = CHECK_INTERVAL_MS): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (!scheduledRunDue(db, now, learningSettings())) return;
    running = true;
    try {
      await runLearningCycle(db, "schedule", now);
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
