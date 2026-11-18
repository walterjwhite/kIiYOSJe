/**
 * Shared value types for the entire mind system.
 * Plain TypeScript — no runtime dependencies.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export const DirectionPosture = {
  absorb: "absorb",
  draft: "draft",
  surface: "surface",
  escalate: "escalate",
} as const;
export type DirectionPosture =
  (typeof DirectionPosture)[keyof typeof DirectionPosture];

export const DirectionAutonomy = {
  observe: "observe",
  draft: "draft",
  send: "send",
} as const;
export type DirectionAutonomy =
  (typeof DirectionAutonomy)[keyof typeof DirectionAutonomy];

export const SignalDisposition = {
  new: "new",
  absorbed: "absorbed",
  filed: "filed",
  promoted: "promoted",
  escalated: "escalated",
} as const;
export type SignalDisposition =
  (typeof SignalDisposition)[keyof typeof SignalDisposition];

export const ThoughtState = {
  seedling: "seedling",
  active: "active",
  parked: "parked",
  closed: "closed",
} as const;
export type ThoughtState = (typeof ThoughtState)[keyof typeof ThoughtState];

export const ActionStatus = {
  proposed: "proposed",
  sent: "sent",
  discarded: "discarded",
  failed: "failed",
} as const;
export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

export const ScopeKind = {
  person: "person",
  project: "project",
  topic: "topic",
  thread: "thread",
} as const;
export type ScopeKind = (typeof ScopeKind)[keyof typeof ScopeKind];

export type SignalKind =
  "question" | "task" | "acknowledgement" | "information" | "event" | "other";

// ── Signals and outbound work ────────────────────────────────────────────────

export interface NewSignal {
  adapter: string;
  externalId: string;
  threadId: string | null;
  sender: string;
  recipients: string[];
  kind: string;
  /** Mail only: the original subject, used to build "Re:" replies. */
  subject?: string | undefined;
  body: string;
  receivedAt: Date;
  urgencyHint: number | null;
}

export interface OutboundDraft {
  threadId: string | null;
  to: string[];
  /** Present for mail-shaped sources (Gmail, Outlook); ignored by chat. */
  subject?: string | undefined;
  body: string;
  replyToExternalId: string | null;
}

export interface SendResult {
  externalId: string;
}

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface CalendarEvent {
  /** Source-stable identifier: iCal UID or Google event id. */
  id: string;
  calendarId: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  attendees: string[];
}

export interface OutboundEvent {
  calendarId?: string | undefined;
  title: string;
  description?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  attendees?: string[] | undefined;
  location?: string | undefined;
}

// ── Adapter contract ─────────────────────────────────────────────────────────

export interface AdapterCapabilities {
  canSend: boolean;
  canStream: boolean;
  canReadCalendar?: boolean | undefined;
  canWriteCalendar?: boolean | undefined;
}

export interface Adapter {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  start(sink: (signal: NewSignal) => void): Promise<void>;
  stop(): Promise<void>;
  send?(draft: OutboundDraft): Promise<SendResult>;
  listEvents?(range: TimeRange): Promise<CalendarEvent[]>;
  createEvent?(event: OutboundEvent): Promise<SendResult>;
}

// ── Direction config (loaded from YAML) ─────────────────────────────────────

export interface DirectionGuards {
  maxPerThreadPerHour?: number | undefined;
  escalateOn?: string[] | undefined;
}

export interface DirectionConfig {
  name: string;
  scope: { kind: ScopeKind; value: string };
  posture: DirectionPosture;
  autonomy: DirectionAutonomy;
  confidenceMin?: number | undefined;
  standard: string;
  guards?: DirectionGuards | undefined;
  /**
   * Optional free-text description of how to recognize a match, used to
   * assist the classifier's directionId choice when scope's literal
   * substring match misses real phrasing (STATUS.md gap #12). Falls back
   * to scope-only matching when absent.
   */
  matchPrompt?: string | undefined;
  /**
   * Optional free-text description of how to actually handle a match,
   * passed to the drafter alongside `standard`. When absent, `standard`
   * alone still drives drafting, same as before this field existed.
   */
  responsePrompt?: string | undefined;
}
