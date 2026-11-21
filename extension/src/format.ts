/** Pure display helpers. No vscode import, so they can be unit-tested. */

/**
 * The connector label. Account-scoped adapters already carry the account in
 * their id ("gmail:75a788d4"), so appending the account again would repeat
 * it. A plain adapter id ("gmail") gets the account appended.
 */
export function channelLabel(adapter: string, account: string | null | undefined): string {
  if (!account) return adapter;
  return adapter === account || adapter.endsWith(`:${account}`) ? adapter : `${adapter}:${account}`;
}

export type TimingBucket = "now" | "today" | "this-week" | "can-wait";

export const BUCKET_LABEL: Record<TimingBucket, string> = {
  now: "Now",
  today: "Today",
  "this-week": "This week",
  "can-wait": "Can wait",
};

/** "3 h ago", "2 d ago", "just now". */
export function ago(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "Now · by Fri, Nov 14, 3:00 PM" or just "Can wait". */
export function timingLabel(bucket: TimingBucket, actBy: string | null): string {
  const base = BUCKET_LABEL[bucket];
  if (!actBy) return base;
  const when = new Date(actBy);
  if (Number.isNaN(when.getTime())) return base;
  return `${base} · by ${when.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
