/**
 * Minimal iCalendar reader for Google Calendar's private iCal feed.
 *
 * Only what a calendar source needs: VEVENT blocks, line unfolding, date and
 * date-time values (with or without Z), summary, description, location,
 * organiser, and attendees. Recurrence rules are not expanded; the feed already
 * carries the expanded instances for the window we ask for.
 */

import type { CalendarEvent } from "@mind/core";

export function parseIcs(text: string, calendarId = "ics"): CalendarEvent[] {
  const lines = unfold(text);
  const events: CalendarEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const event = toEvent(current, calendarId);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const rawName = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const name = rawName.split(";")[0] ?? rawName;
    current[name] = collect(current[name], value);
  }

  return events;
}

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function collect(previous: string | undefined, value: string): string {
  if (previous === undefined) return value;
  if (previous === "") return value;
  return `${previous}\n${value}`;
}

function toEvent(fields: Record<string, string>, calendarId: string): CalendarEvent | null {
  const start = parseIcsDate(fields["DTSTART"]);
  if (!start) return null;
  const end = parseIcsDate(fields["DTEND"]);

  return {
    id: fields["UID"] ?? `${calendarId}:${start.toISOString()}:${fields["SUMMARY"] ?? ""}`,
    calendarId,
    title: decodeText(fields["SUMMARY"]) ?? "(untitled)",
    description: decodeText(fields["DESCRIPTION"]) ?? "",
    startsAt: start,
    endsAt: end,
    allDay: (fields["DTSTART"] ?? "").length === 8,
    location: decodeText(fields["LOCATION"]) ?? null,
    organizer: mailtoOf(fields["ORGANIZER"]),
    attendees: Object.entries(fields)
      .filter(([name]) => name === "ATTENDEE")
      .map(([, value]) => mailtoOf(value))
      .filter((value): value is string => value !== null),
  };
}

export function parseIcsDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!dateTime) return null;
  const [, year, month, day, hour, minute, second, zulu] = dateTime;
  if (zulu === "Z") {
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
  }
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function decodeText(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
}

function mailtoOf(value: string | undefined): string | null {
  if (!value) return null;
  const mailto = /mailto:([^;]+)/i.exec(value);
  return (mailto?.[1] ?? "").trim().toLowerCase() || null;
}
