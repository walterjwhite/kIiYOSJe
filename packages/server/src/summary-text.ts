/**
 * The daily summary as text. Pure: the same words are shown as the transcript
 * and handed to Piper, so what you read is exactly what you hear.
 *
 * Tone changes the wording only. How the voice sounds comes from the Piper
 * prosody settings (see piper.ts).
 */

import type { SummaryTone } from "@mind/core";

export interface SummaryGoal {
  readonly title: string;
  /** Queue items linked to this goal. */
  readonly linked: number;
  readonly overdue: boolean;
  readonly reviewDue: boolean;
}

export interface SummaryItem {
  readonly sender: string;
  readonly summary: string;
  readonly bucket: "now" | "today" | "this-week" | "can-wait";
}

export interface SummaryInput {
  /** YYYY-MM-DD, the operator's local day. */
  readonly date: string;
  readonly goals: readonly SummaryGoal[];
  readonly queue: {
    readonly now: number;
    readonly today: number;
    readonly thisWeek: number;
    readonly canWait: number;
    readonly unlinked: number;
  };
  /** The most pressing items, already ordered. */
  readonly top: readonly SummaryItem[];
  readonly absorbedToday: number;
}

const GREETING: Record<SummaryTone, (spoken: string) => string> = {
  calm: (d) => `Good morning. Here is your plan for ${d}.`,
  neutral: (d) => `Summary for ${d}.`,
  upbeat: (d) => `Good morning! Here is what is on for ${d}.`,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Friday, November 20" in the operator's calendar, from a YYYY-MM-DD string. */
export function spokenDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function oneSentence(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function buildSummary(input: SummaryInput, tone: SummaryTone): string {
  const lines: string[] = [GREETING[tone](spokenDate(input.date))];
  const { queue } = input;
  const waiting = queue.now + queue.today + queue.thisWeek + queue.canWait;

  if (input.goals.length === 0) {
    lines.push("You have no goals set. Add one in the Queue to give your day a focus.");
  } else {
    lines.push(`You have ${plural(input.goals.length, "goal")}.`);
    for (const g of input.goals) {
      const flags = [g.overdue ? "it is overdue" : "", g.reviewDue ? "it is due for review" : ""].filter(Boolean);
      const items = g.linked === 0 ? "nothing linked yet" : `${plural(g.linked, "item")} linked`;
      lines.push(`${oneSentence(g.title, 80)}: ${items}${flags.length ? `, and ${flags.join(" and ")}` : ""}.`);
    }
  }

  if (waiting === 0) {
    lines.push("Nothing is waiting on you.");
  } else {
    const parts = [
      queue.now > 0 ? `${queue.now} need you now` : "",
      queue.today > 0 ? `${queue.today} today` : "",
      queue.thisWeek > 0 ? `${queue.thisWeek} this week` : "",
      queue.canWait > 0 ? `${queue.canWait} can wait` : "",
    ].filter(Boolean);
    lines.push(`${plural(waiting, "item")} awaiting action: ${parts.join(", ")}.`);
    if (queue.unlinked > 0) lines.push(`${queue.unlinked} of them are not linked to a goal.`);
    if (input.top.length > 0) {
      lines.push("Most pressing first.");
      for (const t of input.top) lines.push(`${t.sender}: ${oneSentence(t.summary)}.`.replace(/\.\.$/, "."));
    }
  }

  lines.push(
    input.absorbedToday > 0
      ? `${plural(input.absorbedToday, "message")} ${input.absorbedToday === 1 ? "was" : "were"} handled without reaching you.`
      : "No messages have been handled for you yet today.",
  );
  return lines.join("\n");
}
