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

// ── Adapter types ────────────────────────────────────────────────────────────

export interface NewSignal {
  adapter: string;
  externalId: string;
  threadId: string | null;
  sender: string;
  recipients: string[];
  kind: string;
  body: string;
  receivedAt: Date;
  urgencyHint: number | null;
}

export interface OutboundDraft {
  threadId: string | null;
  to: string[];
  body: string;
  replyToExternalId: string | null;
}

export interface SendResult {
  externalId: string;
}

// ── Adapter interface ────────────────────────────────────────────────────────

export interface Adapter {
  readonly id: string;
  readonly capabilities: { canSend: boolean; canStream: boolean };
  start(sink: (signal: NewSignal) => void): Promise<void>;
  stop(): Promise<void>;
  send?(draft: OutboundDraft): Promise<SendResult>;
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
}
