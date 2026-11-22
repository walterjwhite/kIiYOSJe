/**
 * iCalendar reader for a calendar feed URL, using `node-ical` (Apache-2.0).
 *
 * It handles what the earlier hand-written reader did not: a `TZID` on a start
 * time (so 9:00 in New York is 14:00Z whatever time zone this machine is in),
 * recurring events (`RRULE`, `EXDATE`, edited single instances), and escaped
 * text. A recurring event is expanded only inside the window that is asked for,
 * and one event yields at most MAX_INSTANCES_PER_EVENT instances, so a hostile
 * rule such as `FREQ=SECONDLY` cannot flood the process.
 */

import type { CalendarEvent } from "@mind/core";
import ical, { type VEvent } from "node-ical";

const MAX_INSTANCES_PER_EVENT = 500;
/** Work the expander may do for one event before it gives up. */
const MAX_ITERATIONS = 5_000;
const DAY_MS = 86_400_000;

export interface IcsWindow {
  readonly from: Date;
  readonly to: Date;
}

/** A node-ical text field is a string, or `{ val }` when it carries parameters. */
function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value) {
    const inner = (value as { val: unknown }).val;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

function mailtoOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const mailto = /mailto:([^;]+)/i.exec(raw);
  return (mailto?.[1] ?? "").trim().toLowerCase() || null;
}

function attendeesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map(mailtoOf).filter((v): v is string => v !== null);
}

function toEvent(
  event: VEvent,
  instance: { start: Date; end: Date | null; summary?: string },
  calendarId: string,
): CalendarEvent {
  const allDay = event.datetype === "date";
  // RFC 5545 gives an all-day event without DTEND a one-day end. That is the
  // same as no end, which is how this reader has always reported it.
  const oneDay =
    allDay && instance.end !== null && instance.end.getTime() - instance.start.getTime() === DAY_MS;
  return {
    id: event.uid ?? `${calendarId}:${instance.start.toISOString()}:${text(event.summary) ?? ""}`,
    calendarId,
    title: instance.summary ?? text(event.summary) ?? "(untitled)",
    description: text(event.description) ?? "",
    startsAt: instance.start,
    endsAt: oneDay ? null : instance.end,
    allDay,
    location: text(event.location) ?? null,
    organizer: mailtoOf(event.organizer),
    attendees: attendeesOf(event.attendee),
  };
}

/**
 * Events in a feed. A single event is always returned. A recurring event is
 * returned once per occurrence inside `window` (default: yesterday to 90 days
 * ahead). A feed that cannot be parsed yields no events rather than an error.
 */
export function parseIcs(
  feed: string,
  calendarId = "ics",
  window: IcsWindow = defaultWindow(),
): CalendarEvent[] {
  let parsed: ReturnType<typeof ical.sync.parseICS>;
  try {
    parsed = ical.sync.parseICS(feed);
  } catch {
    return [];
  }

  const events: CalendarEvent[] = [];
  for (const entry of Object.values(parsed)) {
    if (!entry || entry.type !== "VEVENT") continue;
    const event = entry as VEvent;
    if (!(event.start instanceof Date) || Number.isNaN(event.start.getTime())) continue;

    if (event.rrule) {
      let instances: ReturnType<typeof ical.expandRecurringEvent>;
      try {
        instances = ical
          .expandRecurringEvent(event, {
            from: window.from,
            to: window.to,
            maxIterations: MAX_ITERATIONS,
          })
          .slice(0, MAX_INSTANCES_PER_EVENT);
      } catch {
        // A rule that needs more iterations than allowed is hostile or broken.
        // Skip that event; the rest of the feed is still used.
        continue;
      }
      for (const instance of instances) {
        events.push(
          toEvent(
            event,
            {
              start: instance.start,
              end: instance.end instanceof Date ? instance.end : null,
              ...(text(instance.summary) ? { summary: text(instance.summary) as string } : {}),
            },
            calendarId,
          ),
        );
      }
    } else {
      events.push(
        toEvent(
          event,
          { start: event.start, end: event.end instanceof Date ? event.end : null },
          calendarId,
        ),
      );
    }
  }
  return events;
}

function defaultWindow(): IcsWindow {
  const now = Date.now();
  return { from: new Date(now - DAY_MS), to: new Date(now + 90 * DAY_MS) };
}
