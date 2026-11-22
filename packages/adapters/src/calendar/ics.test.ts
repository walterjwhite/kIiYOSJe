import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics.js";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:abc@google.com",
  "SUMMARY:Team sync",
  "DTSTART:20261115T140000Z",
  "DTEND:20261115T150000Z",
  "LOCATION:Room 1",
  "DESCRIPTION:Agenda\\n- status",
  "ATTENDEE;CN=Alice:mailto:Alice@Example.com",
  "ORGANIZER;CN=Bob:mailto:bob@example.com",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:holiday",
  "SUMMARY:Long",
  "  holiday",
  "DTSTART;VALUE=DATE:20261224",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("parses timed and all-day events", () => {
    const events = parseIcs(FEED);
    expect(events).toHaveLength(2);

    const [sync, holiday] = events;
    expect(sync?.id).toBe("abc@google.com");
    expect(sync?.title).toBe("Team sync");
    expect(sync?.startsAt.toISOString()).toBe("2026-11-15T14:00:00.000Z");
    expect(sync?.endsAt?.toISOString()).toBe("2026-11-15T15:00:00.000Z");
    expect(sync?.allDay).toBe(false);
    expect(sync?.attendees).toEqual(["alice@example.com"]);
    expect(sync?.organizer).toBe("bob@example.com");
    expect(sync?.description).toBe("Agenda\n- status");

    expect(holiday?.allDay).toBe(true);
    expect(holiday?.endsAt).toBeNull();
    expect(holiday?.title).toBe("Long holiday");
  });

  it("skips events without a start", () => {
    const events = parseIcs("BEGIN:VEVENT\nUID:x\nSUMMARY:Broken\nEND:VEVENT");
    expect(events).toEqual([]);
  });
});

const window = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") };

function feed(...events: string[][]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flat(), "END:VCALENDAR"].join("\r\n");
}

describe("parseIcs: time zones and date forms", () => {
  it("resolves a TZID to the right instant whatever this machine's zone is", () => {
    const [event] = parseIcs(
      feed([
        "BEGIN:VEVENT",
        "UID:tz",
        "SUMMARY:Call",
        "DTSTART;TZID=America/New_York:20261109T090000",
        "DTEND;TZID=America/New_York:20261109T093000",
        "END:VEVENT",
      ]),
      "ics",
      window,
    );
    expect(event?.startsAt.toISOString()).toBe("2026-11-09T14:00:00.000Z");
    expect(event?.endsAt?.toISOString()).toBe("2026-11-09T14:30:00.000Z");
  });

  it("reads a UTC time, and a date-only start as a local all-day event", () => {
    const [utc, allDay] = parseIcs(
      feed(
        ["BEGIN:VEVENT", "UID:u", "SUMMARY:A", "DTSTART:20261115T140000Z", "END:VEVENT"],
        ["BEGIN:VEVENT", "UID:d", "SUMMARY:B", "DTSTART;VALUE=DATE:20261224", "END:VEVENT"],
      ),
      "ics",
      window,
    );
    expect(utc?.startsAt.toISOString()).toBe("2026-11-15T14:00:00.000Z");
    expect(allDay?.allDay).toBe(true);
    expect(allDay?.startsAt.getFullYear()).toBe(2026);
    expect(allDay?.startsAt.getMonth()).toBe(11);
    expect(allDay?.startsAt.getDate()).toBe(24);
  });

  it("keeps a multi-day all-day event's end", () => {
    const [event] = parseIcs(
      feed([
        "BEGIN:VEVENT",
        "UID:trip",
        "SUMMARY:Trip",
        "DTSTART;VALUE=DATE:20261201",
        "DTEND;VALUE=DATE:20261204",
        "END:VEVENT",
      ]),
      "ics",
      window,
    );
    expect(event?.endsAt).not.toBeNull();
  });

  it("reads a title that carries a parameter", () => {
    const [event] = parseIcs(
      feed([
        "BEGIN:VEVENT",
        "UID:l",
        "SUMMARY;LANGUAGE=en:Holiday",
        "DTSTART;VALUE=DATE:20261224",
        "END:VEVENT",
      ]),
      "ics",
      window,
    );
    expect(event?.title).toBe("Holiday");
  });

  it("returns no events for text that is not a calendar", () => {
    expect(parseIcs("this is not a calendar", "ics", window)).toEqual([]);
    expect(parseIcs("", "ics", window)).toEqual([]);
  });
});

describe("parseIcs: recurring events", () => {
  const weekly = [
    "BEGIN:VEVENT",
    "UID:weekly",
    "SUMMARY:Standup",
    "DTSTART;TZID=America/New_York:20261109T090000",
    "DTEND;TZID=America/New_York:20261109T093000",
    "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO",
    "EXDATE;TZID=America/New_York:20261116T090000",
    "END:VEVENT",
  ];

  it("expands the rule inside the window and honours EXDATE", () => {
    const events = parseIcs(feed(weekly), "ics", window);
    expect(events.map((e) => e.startsAt.toISOString())).toEqual([
      "2026-11-09T14:00:00.000Z",
      "2026-11-23T14:00:00.000Z",
      "2026-11-30T14:00:00.000Z",
    ]);
    expect(new Set(events.map((e) => e.id))).toEqual(new Set(["weekly"]));
  });

  it("returns only the occurrences inside the window", () => {
    const events = parseIcs(feed(weekly), "ics", {
      from: new Date("2026-11-20T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    });
    expect(events).toHaveLength(2);
  });

  it("skips a hostile rule instead of flooding, and keeps the rest of the feed", () => {
    const events = parseIcs(
      feed(
        [
          "BEGIN:VEVENT",
          "UID:flood",
          "SUMMARY:Flood",
          "DTSTART:20261101T000000Z",
          "RRULE:FREQ=SECONDLY",
          "END:VEVENT",
        ],
        ["BEGIN:VEVENT", "UID:ok", "SUMMARY:Fine", "DTSTART:20261115T140000Z", "END:VEVENT"],
      ),
      "ics",
      window,
    );
    expect(events.filter((e) => e.id === "flood").length).toBeLessThanOrEqual(500);
    expect(events.some((e) => e.id === "ok")).toBe(true);
  });
});
