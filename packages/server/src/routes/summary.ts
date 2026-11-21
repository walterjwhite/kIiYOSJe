/**
 * /summary — the day's plan as a transcript and as audio.
 *
 * GET  /summary        the transcript, plus whether an audio render exists and is current
 * POST /summary/audio  render the transcript with Piper (downloads the voice first if allowed)
 * GET  /summary/audio  the last rendered WAV
 *
 * The transcript is built from the Queue and the Goals, so there is one
 * source for what you read and what you hear. Audio is a local file and never
 * leaves the machine; the only network use is the one-time voice download,
 * described in piper.ts.
 */

import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { audioDir, audioSettings, signals, thoughts, voiceDir } from "@mind/core";
import type { Db } from "@mind/core";
import { PiperError, renderSpeech } from "../piper.js";
import type { PiperIo } from "../piper.js";
import { nodePiperIo } from "../piper-io.js";
import { buildQueue } from "./queue.js";
import { buildSummary } from "../summary-text.js";
import type { SummaryInput } from "../summary-text.js";

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function buildSummaryInput(db: Db, now: Date): SummaryInput {
  const items = buildQueue(db, now);
  const nowIso = now.toISOString();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const goals = db
    .select()
    .from(thoughts)
    .where(eq(thoughts.state, "goal"))
    .all()
    .map((g) => ({
      title: g.title,
      linked: items.filter((i) => i.goalId === g.id).length,
      overdue: g.escalateBy !== null && g.escalateBy <= nowIso,
      reviewDue: g.reviewAt !== null && g.reviewAt <= nowIso,
    }));

  const count = (bucket: string) => items.filter((i) => i.timing.bucket === bucket).length;
  const absorbed =
    db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        and(
          sql`${signals.receivedAt} >= ${start.toISOString()}`,
          eq(signals.disposition, "absorbed"),
        ),
      )
      .get()?.count ?? 0;

  return {
    date: localDate(now),
    goals,
    queue: {
      now: count("now"),
      today: count("today"),
      thisWeek: count("this-week"),
      canWait: count("can-wait"),
      unlinked: items.filter((i) => i.goalId === null).length,
    },
    top: items
      .filter((i) => i.timing.bucket === "now" || i.timing.bucket === "today")
      .slice(0, 3)
      .map((i) => ({ sender: i.sender, summary: i.summary, bucket: i.timing.bucket })),
    absorbedToday: absorbed,
  };
}

const wavPath = () => join(audioDir(), "summary.wav");
const textPath = () => join(audioDir(), "summary.txt");

export function summaryRouter(
  db: Db,
  io: PiperIo = nodePiperIo,
  clock: () => Date = () => new Date(),
) {
  const app = new Hono();

  const transcript = () => {
    const settings = audioSettings();
    const input = buildSummaryInput(db, clock());
    return {
      settings,
      text: buildSummary(input, settings.tone),
      absorbedToday: input.absorbedToday,
    };
  };

  app.get("/", (c) => {
    const { settings, text, absorbedToday } = transcript();
    const rendered = existsSync(wavPath());
    let renderedText: string | null = null;
    try {
      renderedText = readFileSync(textPath(), "utf8");
    } catch {
      /* never rendered */
    }
    return c.json({
      date: localDate(clock()),
      text,
      absorbedToday,
      tone: settings.tone,
      audio: rendered
        ? {
            renderedAt: statSync(wavPath()).mtime.toISOString(),
            bytes: statSync(wavPath()).size,
            // The queue changed, or the tone did, since this was rendered.
            stale: renderedText !== text,
          }
        : null,
    });
  });

  app.post("/audio", async (c) => {
    const { settings, text } = transcript();
    mkdirSync(audioDir(), { recursive: true, mode: 0o700 });
    try {
      await renderSpeech(text, settings, voiceDir(), wavPath(), io);
    } catch (err) {
      if (err instanceof PiperError) return c.json({ error: err.message, code: err.code }, 503);
      throw err;
    }
    writeFileSync(textPath(), text, { mode: 0o600 });
    return c.json({ ok: true, voice: settings.voice, bytes: statSync(wavPath()).size });
  });

  app.get("/audio", (c) => {
    if (!existsSync(wavPath())) return c.json({ error: "No audio has been rendered yet" }, 404);
    return c.body(readFileSync(wavPath()), 200, {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    });
  });

  return app;
}
