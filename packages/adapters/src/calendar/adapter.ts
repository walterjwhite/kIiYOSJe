/**
 * Calendar adapter.
 *
 * Read: Google Calendar (OAuth) when configured, otherwise a private iCal URL.
 * Write: create an event in Google Calendar when configured. Upcoming events
 * are emitted as `event` signals so the brief can show what is coming without
 * any mail or chat volume.
 */

import { credentialString } from "@mind/core";
import { logger } from "@mind/core";
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
    private readonly icsUrl = credentialString(
      "calendar",
      "icsUrl",
      "MIND_CALENDAR_ICS_URL",
    ),
    private readonly calendarId = credentialString(
      "calendar",
      "calendarId",
      "MIND_CALENDAR_ID",
    ) ?? "primary",
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    const poll = async (): Promise<void> => {
      try {
        const horizon = new Date(Date.now() + HORIZON_HOURS * 3_600_000);
        for (const event of await this.listEvents({
          from: new Date(),
          to: horizon,
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
    logger.info({ adapter: this.id }, "calendar adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async listEvents(range: TimeRange): Promise<CalendarEvent[]> {
    try {
      return await this.google.listEvents(this.calendarId, range);
    } catch (err) {
      if (!this.icsUrl) throw err;
      logger.info({ adapter: this.id }, "calendar: falling back to iCal feed");
      const response = await fetch(this.icsUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(`iCal feed returned ${response.status}`);
      return parseIcs(await response.text(), this.calendarId).filter(
        (event) => event.startsAt >= range.from && event.startsAt <= range.to,
      );
    }
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
      calendarId: event.calendarId ?? this.calendarId,
    });
  }

  /** Null when this event instance was already emitted in this process. */
  private toSignal(event: CalendarEvent): NewSignal | null {
    const key = `calendar:${event.id}:${event.startsAt.toISOString()}`;
    if (this.emitted.has(key)) return null;
    this.emitted.add(key);

    return {
      adapter: this.id,
      externalId: key,
      threadId: event.calendarId,
      sender: event.organizer ?? this.calendarId,
      recipients: event.attendees,
      kind: "event",
      subject: event.title,
      body: [
        `Event: ${event.title}`,
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
