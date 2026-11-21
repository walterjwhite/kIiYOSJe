/**
 * Queue planning helpers. Pure, no vscode import, unit-tested.
 *
 * Each item is either planned for a calendar day (`plannedFor`, YYYY-MM-DD in
 * the operator's timezone) or has no plan, which makes it backlog.
 *
 *   today     planned for today, plus anything planned earlier and still open
 *             (carried over, so a missed plan is never silently lost)
 *   upcoming  planned for a later day
 *   backlog   no plan
 *   all       everything
 */

export type QueueView = "today" | "upcoming" | "backlog" | "all";
export type PlanState = "backlog" | "overdue" | "today" | "upcoming";

export const VIEWS: readonly { id: QueueView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "backlog", label: "Backlog" },
  { id: "all", label: "All" },
];

export interface Plannable {
  plannedFor: string | null;
  timing: { bucket: string; actBy: string | null };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in the local timezone. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date arithmetic on YYYY-MM-DD strings, safe across DST (done at local noon). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + days, 12));
}

/** The next Monday strictly after `date`. */
export function nextMonday(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = new Date(y, m - 1, d, 12).getDay(); // 0 Sun .. 6 Sat
  return addDays(date, ((8 - dow) % 7) || 7);
}

export function planState(plannedFor: string | null, today: string): PlanState {
  if (!plannedFor) return "backlog";
  if (plannedFor < today) return "overdue";
  return plannedFor === today ? "today" : "upcoming";
}

export function inView(item: Plannable, view: QueueView, today: string): boolean {
  const state = planState(item.plannedFor, today);
  switch (view) {
    case "today":
      return state === "today" || state === "overdue";
    case "upcoming":
      return state === "upcoming";
    case "backlog":
      return state === "backlog";
    case "all":
      return true;
  }
}

export function viewCounts(items: Plannable[], today: string): Record<QueueView, number> {
  const counts: Record<QueueView, number> = { today: 0, upcoming: 0, backlog: 0, all: items.length };
  for (const item of items) {
    for (const v of ["today", "upcoming", "backlog"] as const) {
      if (inView(item, v, today)) counts[v]++;
    }
  }
  return counts;
}

/** Unplanned items that cannot wait for a later day: already due, or due today. */
export function dueUnplanned<T extends Plannable>(items: T[], today: string): T[] {
  return items.filter((item) => {
    if (item.plannedFor) return false;
    if (item.timing.bucket === "now") return true;
    return item.timing.actBy !== null && localDate(new Date(item.timing.actBy)) <= today;
  });
}

const dateFmt = (date: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, opts);
};

/** "Today", "Tomorrow", "Fri, Nov 21", "Carried over from Nov 18", or "Backlog". */
export function planLabel(plannedFor: string | null, today: string): string {
  switch (planState(plannedFor, today)) {
    case "backlog":
      return "Backlog";
    case "today":
      return "Today";
    case "overdue":
      return `Carried over from ${dateFmt(plannedFor!, { month: "short", day: "numeric" })}`;
    case "upcoming":
      return plannedFor === addDays(today, 1)
        ? "Tomorrow"
        : dateFmt(plannedFor!, { weekday: "short", month: "short", day: "numeric" });
  }
}

/** A typed date: a real YYYY-MM-DD that is not in the past, else undefined. */
export function parsePlanDate(input: string, today: string): string | undefined {
  const text = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const [y, m, d] = text.split("-").map(Number) as [number, number, number];
  const real = new Date(y, m - 1, d, 12);
  if (real.getFullYear() !== y || real.getMonth() !== m - 1 || real.getDate() !== d) return undefined;
  return text >= today ? text : undefined;
}

/** Items grouped by planned date, dates ascending. For the Upcoming view. */
export function groupByDate<T extends Plannable>(items: T[]): Array<{ date: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!item.plannedFor) continue;
    groups.set(item.plannedFor, [...(groups.get(item.plannedFor) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, items: list }));
}
