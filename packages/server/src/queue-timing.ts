/**
 * When does a Queue item need the operator?
 *
 * The question for each item is whether seeing it now rather than later
 * changes anything: a decision, or what the operator would say. A reply to a
 * question someone is waiting on does. An informational notice with no
 * deadline does not, and says so, so it can be handled in a batch.
 *
 * Pure function of the item's classification and deadline. The `reason`
 * is shown to the operator verbatim.
 */

export type TimingBucket = "now" | "today" | "this-week" | "can-wait";

export interface QueueTiming {
  bucket: TimingBucket;
  /** ISO-8601 deadline, when the message or classifier gave one. */
  actBy: string | null;
  reason: string;
}

export interface TimingInput {
  type: "reply" | "attention";
  signalKind: string | null;
  urgency: string | null;
  escalateBy: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const BUCKET_RANK: Record<TimingBucket, number> = {
  now: 0,
  today: 1,
  "this-week": 2,
  "can-wait": 3,
};

function span(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60_000))} min`;
  if (abs < DAY) return `${Math.round(abs / HOUR)} h`;
  return `${Math.round(abs / DAY)} d`;
}

export function queueTiming(input: TimingInput, now: Date): QueueTiming {
  const deadline = input.escalateBy ? Date.parse(input.escalateBy) : NaN;

  if (!Number.isNaN(deadline)) {
    const left = deadline - now.getTime();
    const actBy = new Date(deadline).toISOString();
    if (left <= 0) {
      return { bucket: "now", actBy, reason: `Deadline passed ${span(left)} ago.` };
    }
    if (left <= 4 * HOUR) {
      return { bucket: "now", actBy, reason: `Due in ${span(left)}.` };
    }
    if (left <= DAY) {
      return { bucket: "today", actBy, reason: `Due in ${span(left)}.` };
    }
    if (left <= 7 * DAY) {
      return { bucket: "this-week", actBy, reason: `Due in ${span(left)}.` };
    }
    return { bucket: "can-wait", actBy, reason: `Not due for ${span(left)}.` };
  }

  const kind = input.signalKind;
  const waitingOnAnswer = kind === "question" || kind === "task";

  if (input.urgency === "high") {
    return {
      bucket: "today",
      actBy: null,
      reason: "Classified as high urgency, but no deadline was stated.",
    };
  }

  if (waitingOnAnswer) {
    return input.urgency === "low"
      ? {
          bucket: "this-week",
          actBy: null,
          reason: `Someone asked for something (${kind}), low urgency, no deadline stated.`,
        }
      : {
          bucket: "today",
          actBy: null,
          reason: `Someone asked for something (${kind}) and is waiting on an answer. No deadline stated.`,
        };
  }

  return {
    bucket: "can-wait",
    actBy: null,
    reason:
      input.type === "reply"
        ? "Informational message with a courtesy reply drafted. Nothing is waiting on you, and a delay changes no decision."
        : "Informational. Nothing is waiting on a reply, and seeing it later changes no decision. Fine to clear in a batch.",
  };
}
