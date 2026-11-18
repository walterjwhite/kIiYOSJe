import { describe, expect, it } from "vitest";
import { parseIcs, parseIcsDate } from "./ics.js";

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

describe("parseIcsDate", () => {
  it("treats a bare date as local midnight", () => {
    const date = parseIcsDate("20261224");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(11);
    expect(date?.getDate()).toBe(24);
  });

  it("returns null for junk", () => {
    expect(parseIcsDate("next tuesday")).toBeNull();
    expect(parseIcsDate(undefined)).toBeNull();
  });
});
