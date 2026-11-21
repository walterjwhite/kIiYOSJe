/**
 * Calendar adapter.
 *
 * Read: any number of Google calendars (OAuth) and/or private iCal feeds,
 * across any number of Google accounts. Write: create an event in one
 * (account, calendar) pair when configured. Upcoming events are emitted as
 * `event` signals so the brief can show what is coming without any mail or
 * chat volume.
 *
 * More than one calendar — and more than one account — means more than one
 * copy of the same meeting. Events are therefore merged by start time and
 * title before they become signals, so one meeting is one Thought, whichever
 * calendars it lives on.
 */

import { credentialString, loadCredentials, logger } from "@mind/core";
import type { Adapter, CalendarEvent, NewSignal, OutboundEvent, TimeRange } from "@mind/core";
import { AdapterNotConfiguredError, isNotConfigured } from "../errors.js";
import { googleAccessTokenFor, googleAccountLabels, googleCredentials } from "../google/auth.js";
import { GoogleCalendarClient } from "./google.js";
import { parseIcs } from "./ics.js";

const DEFAULT_POLL_MS = 15 * 60 * 1000;
const HORIZON_HOURS = 24;

export type CalendarSource =
  | {
      kind: "google";
      calendarId: string;
      /** Which Google account the calendar belongs to. Defaults to `default`. */
      account?: string | undefined;
      /** Only set by the legacy single-calendar config. */
      fallbackIcsUrl?: string | undefined;
    }
  | { kind: "ics"; url: string; label: string; account?: string | undefined };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Sources in the order they should be tried. */
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

  const icsUrl = credentialString("calendar", "icsUrl", "MIND_CALENDAR_ICS_URL");
  const calendarId = credentialString("calendar", "calendarId", "MIND_CALENDAR_ID") ?? "primary";

  // Every Google account gets its primary calendar. Without a configured
  // account this is the original single default source.
  const labels = googleAccountLabels();
  const accounts = labels.length > 0 ? labels : ["default"];
  return accounts.map((account) => ({
    kind: "google" as const,
    calendarId,
    ...(account !== "default" ? { account } : {}),
    ...(account === "default" && icsUrl ? { fallbackIcsUrl: icsUrl } : {}),
  }));
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
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const fields = entry as Record<string, unknown>;
    const label = nonEmptyString(fields["label"]);
    const account = nonEmptyString(fields["account"]);
    const google = fields["google"];
    const ics = fields["ics"];
    if (typeof google === "string" && google.length > 0) {
      sources.push({
        kind: "google",
        calendarId: google,
        ...(account ? { account } : {}),
      });
    } else if (typeof ics === "string" && ics.length > 0) {
      sources.push({
        kind: "ics",
        url: ics,
        label: label ?? "ics",
        ...(account ? { account } : {}),
      });
    }
  }
  return sources;
}

export interface CalendarWriteTarget {
  account: string;
  calendarId: string;
}

/**
 * Where a created event goes. `calendar.writeTo` may be a calendar id or an
 * `{ account, calendar }` pair; `calendar.writeToAccount` names the account
 * for the string form. Otherwise the first Google source — with its account —
 * wins.
 */
export function defaultWriteTarget(
  sources: CalendarSource[] = calendarSources(),
): CalendarWriteTarget {
  const calendar = loadCredentials()["calendar"] ?? {};
  const raw = calendar["writeTo"];
  let calendarId: string | undefined;
  let account: string | undefined;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const fields = raw as Record<string, unknown>;
    calendarId = nonEmptyString(fields["calendar"]) ?? nonEmptyString(fields["calendarId"]);
    account = nonEmptyString(fields["account"]);
  } else {
    calendarId = nonEmptyString(raw);
  }

  const explicitAccount =
    credentialString("calendar", "writeToAccount", "MIND_CALENDAR_WRITE_TO_ACCOUNT") ??
    nonEmptyString(calendar["writeToAccount"]);

  const googleSources = sources.filter(
    (source): source is Extract<CalendarSource, { kind: "google" }> => source.kind === "google",
  );
  const chosen = calendarId
    ? googleSources.find((source) => source.calendarId === calendarId)
    : googleSources[0];

  return {
    account: account ?? explicitAccount ?? chosen?.account ?? "default",
    calendarId: calendarId ?? chosen?.calendarId ?? "primary",
  };
}

/** Backward-compatible helper: only the calendar id of the write target. */
export function defaultWriteCalendarId(sources: CalendarSource[] = calendarSources()): string {
  return defaultWriteTarget(sources).calendarId;
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
  private readonly google: GoogleCalendarClient;
  private readonly sources: CalendarSource[];
  private readonly writeCalendarId: string;
  private readonly pollMs: number;
  private readonly clients: Record<string, GoogleCalendarClient>;
  private readonly writeAccount: string;

  constructor(
    google = new GoogleCalendarClient(() => googleAccessTokenFor()),
    sources: CalendarSource[] = calendarSources(),
    writeCalendarId = defaultWriteCalendarId(sources),
    pollMs = DEFAULT_POLL_MS,
    clients: Record<string, GoogleCalendarClient> = {},
    writeAccount = "default",
  ) {
    this.google = google;
    this.sources = sources;
    this.writeCalendarId = writeCalendarId;
    this.pollMs = pollMs;
    this.clients = clients;
    this.writeAccount = writeAccount;
  }

  /** One adapter over every configured Google account and iCal feed. */
  static fromConfig(): CalendarAdapter {
    const clients: Record<string, GoogleCalendarClient> = {};
    for (const label of googleAccountLabels()) {
      clients[label] = new GoogleCalendarClient(() => googleAccessTokenFor(label));
    }
    const sources = calendarSources();
    const target = defaultWriteTarget(sources);
    return new CalendarAdapter(
      new GoogleCalendarClient(() => googleAccessTokenFor()),
      sources,
      target.calendarId,
      DEFAULT_POLL_MS,
      clients,
      target.account,
    );
  }

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
          logger.info({ adapter: this.id }, "calendar: no credentials, adapter idle");
          return;
        }
        logger.warn({ adapter: this.id, err: String(err) }, "calendar: poll failed");
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info(
      {
        adapter: this.id,
        sources: this.sources.map((source) =>
          source.kind === "google"
            ? `${source.account ?? "default"}:${source.calendarId}`
            : `${source.account ?? "default"}:${source.label}`,
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
              source:
                source.kind === "google"
                  ? `${source.account ?? "default"}:${source.calendarId}`
                  : `${source.account ?? "default"}:${source.label}`,
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
    if (!googleCredentials(this.writeAccount)) {
      throw new AdapterNotConfiguredError(
        "calendar",
        `Google Calendar credentials for account '${this.writeAccount}'`,
      );
    }
    return this.clientFor(this.writeAccount).createEvent({
      ...event,
      calendarId: event.calendarId ?? this.writeCalendarId,
    });
  }

  private clientFor(account: string): GoogleCalendarClient {
    if (account === "default") return this.google;
    const client = this.clients[account];
    if (!client) {
      // Never fall back to another account's token: that would silently read
      // or write the wrong mailbox's calendar.
      throw new AdapterNotConfiguredError("calendar", `Google account '${account}'`);
    }
    return client;
  }

  private async fromSource(source: CalendarSource, range: TimeRange): Promise<CalendarEvent[]> {
    const account = source.account ?? "default";
    let events: CalendarEvent[];

    if (source.kind === "ics") {
      events = await this.fromIcs(source.url, source.label, range);
    } else {
      try {
        events = await this.clientFor(account).listEvents(source.calendarId, range);
      } catch (err) {
        if (!source.fallbackIcsUrl) throw err;
        logger.info(
          { adapter: this.id, account, calendarId: source.calendarId },
          "calendar: falling back to iCal feed",
        );
        events = await this.fromIcs(source.fallbackIcsUrl, source.calendarId, range);
      }
    }

    return events.map((event) => ({ ...event, account }));
  }

  private async fromIcs(url: string, label: string, range: TimeRange): Promise<CalendarEvent[]> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`iCal feed returned ${response.status}`);
    return parseIcs(await response.text(), label).filter(
      (event) => event.startsAt >= range.from && event.startsAt <= range.to,
    );
  }

  /** Null when this event instance was already emitted in this process. */
  private toSignal(event: CalendarEvent): NewSignal | null {
    const account = event.account ?? "default";
    const key = `calendar:${account}:${event.calendarId}:${event.id}:${event.startsAt.toISOString()}`;
    if (this.emitted.has(key)) return null;
    this.emitted.add(key);

    return {
      adapter: this.id,
      account,
      externalId: key,
      threadId: `${account}:${event.calendarId}`,
      sender: event.organizer ?? event.calendarId,
      recipients: event.attendees,
      kind: "event",
      subject: event.title,
      body: [
        `Event: ${event.title}`,
        `Account: ${account}`,
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
