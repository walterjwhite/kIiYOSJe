/**
 * Calendar adapter.
 *
 * Read: any number of Google calendars (OAuth) and/or private iCal feeds.
 * Write: create an event in one Google calendar when configured. Upcoming
 * events are emitted as `event` signals so the brief can show what is coming
 * without any mail or chat volume.
 *
 * More than one calendar means more than one copy of the same meeting — an
 * invitation shows up on every calendar that accepted it. Events are therefore
 * merged by start time and title before they become signals, so one meeting is
 * one Thought, whichever calendars it lives on.
 */

import { credentialString, loadCredentials, logger } from "@mind/core";
import type {
  Adapter,
  CalendarEvent,
  NewSignal,
  OutboundEvent,
  TimeRange,
} from "@mind/core";
import { AdapterNotConfiguredError, isNotConfigured } from "../errors.js";
import { googleAccessToken } from "../google/auth.js";
import { GoogleCalendarClient } from "./google.js";
import { parseIcs } from "./ics.js";

const DEFAULT_POLL_MS = 15 * 60 * 1000;
const HORIZON_HOURS = 24;

export type CalendarSource =
  | {
      kind: "google";
      calendarId: string;
      /** Only set by the legacy single-calendar config. */
      fallbackIcsUrl?: string | undefined;
    }
  | { kind: "ics"; url: string; label: string };

/**
 * Sources in the order they should be tried. `calendar.sources` is a list
 * (strings are allowed for brevity); without it, the older single
 * `calendar.calendarId` / `calendar.icsUrl` keys still work.
 */
export function calendarSources(): CalendarSource[] {
  const raw = loadCredentials()["calendar"]?.["sources"];
  if (Array.isArray(raw)) {
    const parsed = parseCalendarSources(raw);
    if (parsed.length > 0) return parsed;
    logger.warn(
      { adapter: "calendar" },
      "calendar: sources is empty or unreadable, falling back to calendarId/icsUrl",
    );
  }

  const icsUrl = credentialString(
    "calendar",
    "icsUrl",
    "MIND_CALENDAR_ICS_URL",
  );
  const calendarId =
    credentialString("calendar", "calendarId", "MIND_CALENDAR_ID") ?? "primary";
  return [
    icsUrl
      ? { kind: "google", calendarId, fallbackIcsUrl: icsUrl }
      : { kind: "google", calendarId },
  ];
}

/** Pure parser, so malformed entries can be dropped without failing startup. */
export function parseCalendarSources(raw: unknown[]): CalendarSource[] {
  const sources: CalendarSource[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const value = entry.trim();
      if (!value) continue;
      if (value.includes("://")) {
        sources.push({ kind: "ics", url: value, label: "ics" });
      } else {
        sources.push({ kind: "google", calendarId: value });
      }
      continue;
    }
    if (!entry || typeof entry !== "object") continue;

    const fields = entry as Record<string, unknown>;
    const label =
      typeof fields["label"] === "string" && fields["label"].length > 0
        ? fields["label"]
        : undefined;
    const google = fields["google"];
    const ics = fields["ics"];
    if (typeof google === "string" && google.length > 0) {
      sources.push({ kind: "google", calendarId: google });
    } else if (typeof ics === "string" && ics.length > 0) {
      sources.push({ kind: "ics", url: ics, label: label ?? "ics" });
    }
  }
  return sources;
}

/** Which calendar a created event goes to: `calendar.writeTo`, else the first Google source. */
export function defaultWriteCalendarId(
  sources: CalendarSource[] = calendarSources(),
): string {
  const configured = credentialString(
    "calendar",
    "writeTo",
    "MIND_CALENDAR_WRITE_TO",
  );
  if (configured) return configured;
  const google = sources.find((source) => source.kind === "google");
  return google?.kind === "google" ? google.calendarId : "primary";
}

export class CalendarAdapter implements Adapter {
  readonly id = "calendar";
  readonly capabilities = {
    canSend: false,
    canStream: false,
    canReadCalendar: true,
    canWriteCalendar: true,
  };
  private timer: NodeJS.Timeout | undefined;
  private readonly emitted = new Set<string>();

  constructor(
    private readonly google = new GoogleCalendarClient(() =>
      googleAccessToken(),
    ),
    private readonly sources: CalendarSource[] = calendarSources(),
    private readonly writeCalendarId = defaultWriteCalendarId(sources),
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    const poll = async (): Promise<void> => {
      try {
        for (const event of await this.listEvents({
          from: new Date(),
          to: new Date(Date.now() + HORIZON_HOURS * 3_600_000),
        })) {
          const signal = this.toSignal(event);
          if (signal) sink(signal);
        }
      } catch (err) {
        if (isNotConfigured(err)) {
          logger.info(
            { adapter: this.id },
            "calendar: no credentials, adapter idle",
          );
          return;
        }
        logger.warn(
          { adapter: this.id, err: String(err) },
          "calendar: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info(
      {
        adapter: this.id,
        sources: this.sources.map((source) =>
          source.kind === "google" ? source.calendarId : source.label,
        ),
      },
      "calendar adapter started",
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Events from every source, merged. A failing source is logged and skipped —
   * one revoked token must not hide the other calendars. If every source fails,
   * the first error is rethrown so the poll loop reports it.
   */
  async listEvents(range: TimeRange): Promise<CalendarEvent[]> {
    const merged: CalendarEvent[] = [];
    const seen = new Set<string>();
    let firstError: unknown;

    for (const source of this.sources) {
      let events: CalendarEvent[];
      try {
        events = await this.fromSource(source, range);
      } catch (err) {
        firstError ??= err;
        if (!isNotConfigured(err)) {
          logger.warn(
            {
              adapter: this.id,
              source: source.kind === "google" ? source.calendarId : source.label,
              err: String(err),
            },
            "calendar: source failed, continuing with the rest",
          );
        }
        continue;
      }

      for (const event of events) {
        // Same meeting on two calendars: same start, same title.
        const key = `${event.startsAt.toISOString()}|${event.title.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(event);
      }
    }

    if (merged.length === 0 && firstError !== undefined) throw firstError;
    return merged.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async createEvent(event: OutboundEvent): Promise<{ externalId: string }> {
    if (
      !credentialString("google", "refreshToken", "MIND_GOOGLE_REFRESH_TOKEN")
    ) {
      throw new AdapterNotConfiguredError(
        "calendar",
        "Google Calendar credentials",
      );
    }
    return this.google.createEvent({
      ...event,
      calendarId: event.calendarId ?? this.writeCalendarId,
    });
  }

  private async fromSource(
    source: CalendarSource,
    range: TimeRange,
  ): Promise<CalendarEvent[]> {
    if (source.kind === "ics") {
      return this.fromIcs(source.url, source.label, range);
    }
    try {
      return await this.google.listEvents(source.calendarId, range);
    } catch (err) {
      if (!source.fallbackIcsUrl) throw err;
      logger.info(
        { adapter: this.id, calendarId: source.calendarId },
        "calendar: falling back to iCal feed",
      );
      return this.fromIcs(source.fallbackIcsUrl, source.calendarId, range);
    }
  }

  private async fromIcs(
    url: string,
    label: string,
    range: TimeRange,
  ): Promise<CalendarEvent[]> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`iCal feed returned ${response.status}`);
    return parseIcs(await response.text(), label).filter(
      (event) => event.startsAt >= range.from && event.startsAt <= range.to,
    );
  }

  /** Null when this event instance was already emitted in this process. */
  private toSignal(event: CalendarEvent): NewSignal | null {
    const key = `calendar:${event.calendarId}:${event.id}:${event.startsAt.toISOString()}`;
    if (this.emitted.has(key)) return null;
    this.emitted.add(key);

    return {
      adapter: this.id,
      externalId: key,
      threadId: event.calendarId,
      sender: event.organizer ?? event.calendarId,
      recipients: event.attendees,
      kind: "event",
      subject: event.title,
      body: [
        `Event: ${event.title}`,
        `Calendar: ${event.calendarId}`,
        `Starts: ${event.startsAt.toISOString()}`,
        ...(event.endsAt ? [`Ends: ${event.endsAt.toISOString()}`] : []),
        ...(event.location ? [`Location: ${event.location}`] : []),
        ...(event.description ? ["", event.description] : []),
      ].join("\n"),
      receivedAt: new Date(),
      urgencyHint: null,
    };
  }
}
