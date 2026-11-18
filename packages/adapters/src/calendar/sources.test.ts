import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetCredentialCache } from "@mind/core";
import type { CalendarEvent, TimeRange } from "@mind/core";
import {
  CalendarAdapter,
  calendarSources,
  defaultWriteCalendarId,
  parseCalendarSources,
} from "./adapter.js";
import type { GoogleCalendarClient } from "./google.js";

let dir: string;
let previousConfigDir: string | undefined;

function writeCredentials(body: string): void {
  writeFileSync(join(dir, "credentials.yml"), body, "utf8");
  resetCredentialCache();
}

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    calendarId: "primary",
    title: "Standup",
    description: "",
    startsAt: new Date("2026-11-18T09:00:00Z"),
    endsAt: null,
    allDay: false,
    location: null,
    organizer: null,
    attendees: [],
    ...overrides,
  };
}

const range: TimeRange = {
  from: new Date("2026-11-18T00:00:00Z"),
  to: new Date("2026-11-19T00:00:00Z"),
};

beforeEach(() => {
  previousConfigDir = process.env["MIND_CONFIG_DIR"];
  dir = mkdtempSync(join(tmpdir(), "mind-calendar-"));
  process.env["MIND_CONFIG_DIR"] = dir;
  resetCredentialCache();
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env["MIND_CONFIG_DIR"];
  else process.env["MIND_CONFIG_DIR"] = previousConfigDir;
  resetCredentialCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("parseCalendarSources", () => {
  it("accepts bare calendar ids and urls", () => {
    expect(
      parseCalendarSources([
        "primary",
        "work@example.com",
        "https://calendar.example.com/private/basic.ics",
      ]),
    ).toEqual([
      { kind: "google", calendarId: "primary" },
      { kind: "google", calendarId: "work@example.com" },
      {
        kind: "ics",
        url: "https://calendar.example.com/private/basic.ics",
        label: "ics",
      },
    ]);
  });

  it("accepts objects, keeping an ics label and dropping junk", () => {
    expect(
      parseCalendarSources([
        { google: "team@example.com" },
        { ics: "https://example.com/a.ics", label: "personal" },
        { google: "" },
        { neither: "x" },
        null,
        42,
        "",
      ]),
    ).toEqual([
      { kind: "google", calendarId: "team@example.com" },
      { kind: "ics", url: "https://example.com/a.ics", label: "personal" },
    ]);
  });
});

describe("calendarSources", () => {
  it("reads the list from credentials.yml", () => {
    writeCredentials(
      ['calendar:', '  sources:', '    - primary', '    - "work@example.com"'].join(
        "\n",
      ),
    );
    expect(calendarSources()).toEqual([
      { kind: "google", calendarId: "primary" },
      { kind: "google", calendarId: "work@example.com" },
    ]);
  });

  it("falls back to the single-calendar keys", () => {
    writeCredentials('calendar:\n  icsUrl: "https://example.com/basic.ics"\n');
    expect(calendarSources()).toEqual([
      {
        kind: "google",
        calendarId: "primary",
        fallbackIcsUrl: "https://example.com/basic.ics",
      },
    ]);
  });

  it("defaults to the primary Google calendar", () => {
    writeCredentials("google:\n  refreshToken: token\n");
    expect(calendarSources()).toEqual([
      { kind: "google", calendarId: "primary" },
    ]);
  });
});

describe("defaultWriteCalendarId", () => {
  it("prefers calendar.writeTo", () => {
    writeCredentials("calendar:\n  writeTo: team@example.com\n");
    expect(
      defaultWriteCalendarId([{ kind: "google", calendarId: "primary" }]),
    ).toBe("team@example.com");
  });

  it("opts for the first Google source otherwise", () => {
    writeCredentials("");
    expect(
      defaultWriteCalendarId([
        { kind: "ics", url: "https://example.com/a.ics", label: "personal" },
        { kind: "google", calendarId: "work@example.com" },
      ]),
    ).toBe("work@example.com");
  });
});

describe("CalendarAdapter with several sources", () => {
  it("merges calendars and reports a shared meeting once", async () => {
    const called: string[] = [];
    const google = {
      listEvents: async (calendarId: string): Promise<CalendarEvent[]> => {
        called.push(calendarId);
        return calendarId === "primary"
          ? [
              calendarEvent({ id: "a", calendarId: "primary" }),
              calendarEvent({ id: "shared-1", calendarId: "primary", title: "1:1" }),
            ]
          : [
              calendarEvent({
                id: "b",
                calendarId: "work@example.com",
                title: "Review",
                startsAt: new Date("2026-11-18T10:00:00Z"),
              }),
              calendarEvent({
                id: "shared-2",
                calendarId: "work@example.com",
                title: "1:1",
              }),
            ];
      },
    } as unknown as GoogleCalendarClient;

    const adapter = new CalendarAdapter(google, [
      { kind: "google", calendarId: "primary" },
      { kind: "google", calendarId: "work@example.com" },
    ]);

    const events = await adapter.listEvents(range);
    expect(called).toEqual(["primary", "work@example.com"]);
    expect(events.map((event) => event.title)).toEqual([
      "Standup",
      "1:1",
      "Review",
    ]);
    expect(events.filter((event) => event.title === "1:1").length).toBe(1);
  });

  it("keeps the working calendars when one source fails", async () => {
    const google = {
      listEvents: async (calendarId: string): Promise<CalendarEvent[]> => {
        if (calendarId === "broken") throw new Error("401 invalid_grant");
        return [calendarEvent({ id: "a", calendarId })];
      },
    } as unknown as GoogleCalendarClient;

    const adapter = new CalendarAdapter(google, [
      { kind: "google", calendarId: "broken" },
      { kind: "google", calendarId: "primary" },
    ]);

    const events = await adapter.listEvents(range);
    expect(events.map((event) => event.calendarId)).toEqual(["primary"]);
  });

  it("throws when every source fails, so the poll loop can report it", async () => {
    const google = {
      listEvents: async (): Promise<CalendarEvent[]> => {
        throw new Error("boom");
      },
    } as unknown as GoogleCalendarClient;

    const adapter = new CalendarAdapter(google, [
      { kind: "google", calendarId: "primary" },
      { kind: "google", calendarId: "work@example.com" },
    ]);

    await expect(adapter.listEvents(range)).rejects.toThrow("boom");
  });
});
