/**
 * Google Calendar REST client (events.list / events.insert), reusing the
 * Google OAuth token shared with Gmail.
 */

import { requestJson } from "@mind/core";
import type {
  CalendarEvent,
  OutboundEvent,
  TimeRange,
} from "@mind/core";
import type { TokenResolver } from "../gmail/client.js";

const BASE_URL = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarClient {
  constructor(
    private readonly token: TokenResolver,
    private readonly baseUrl = BASE_URL,
  ) {}

  async listEvents(
    calendarId: string,
    range: TimeRange,
  ): Promise<CalendarEvent[]> {
    const query = new URLSearchParams({
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });
    const response = await requestJson<{ items?: GoogleEvent[] }>(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      { headers: await this.authHeaders() },
    );
    return (response.items ?? []).map((item) =>
      toCalendarEvent(item, calendarId),
    );
  }

  async createEvent(event: OutboundEvent): Promise<{ externalId: string }> {
    const calendarId = event.calendarId ?? "primary";
    const response = await requestJson<{ id: string }>(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        headers: await this.authHeaders(),
        json: {
          summary: event.title,
          description: event.description ?? "",
          location: event.location ?? "",
          start: { dateTime: event.startsAt.toISOString() },
          end: {
            dateTime: (
              event.endsAt ?? defaultEnd(event.startsAt)
            ).toISOString(),
          },
          attendees: (event.attendees ?? []).map((email) => ({ email })),
        },
      },
    );
    return { externalId: response.id };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  organizer?: { email?: string };
  attendees?: { email?: string }[];
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export function toCalendarEvent(
  item: GoogleEvent,
  calendarId: string,
): CalendarEvent {
  const start = parseGoogleDate(item.start);
  return {
    id: item.id,
    calendarId,
    title: item.summary ?? "(untitled)",
    description: item.description ?? "",
    startsAt: start.at,
    endsAt: parseGoogleDate(item.end).at,
    allDay: start.allDay,
    location: item.location ?? null,
    organizer: item.organizer?.email?.toLowerCase() ?? null,
    attendees: (item.attendees ?? [])
      .map((attendee) => attendee.email?.toLowerCase() ?? "")
      .filter((email) => email.length > 0),
  };
}

function parseGoogleDate(value?: { date?: string; dateTime?: string }): {
  at: Date;
  allDay: boolean;
} {
  if (value?.date) {
    const [year = "1970", month = "01", day = "01"] = value.date.split("-");
    return {
      at: new Date(Number(year), Number(month) - 1, Number(day)),
      allDay: true,
    };
  }
  return {
    at: value?.dateTime ? new Date(value.dateTime) : new Date(0),
    allDay: false,
  };
}

function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + 60 * 60 * 1000);
}
