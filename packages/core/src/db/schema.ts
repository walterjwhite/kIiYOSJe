/**
 * Drizzle schema — five tables, enums stored as text.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── directions ───────────────────────────────────────────────────────────────

export const directions = sqliteTable("directions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scopeKind: text("scope_kind").notNull(), // ScopeKind
  scopeValue: text("scope_value").notNull(),
  posture: text("posture").notNull(), // DirectionPosture
  standard: text("standard").notNull(),
  autonomy: text("autonomy").notNull().default("observe"), // DirectionAutonomy
  confidenceMin: real("confidence_min").notNull().default(0.7),
  guards: text("guards"), // JSON blob of DirectionGuards
  matchPrompt: text("match_prompt"),       // how to recognize a match, beyond scope
  responsePrompt: text("response_prompt"), // how to actually respond, alongside standard
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// ── signals ──────────────────────────────────────────────────────────────────

export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    adapter: text("adapter").notNull(),
    externalId: text("external_id").notNull(),
    threadId: text("thread_id"),
    sender: text("sender").notNull(),
    recipients: text("recipients").notNull(), // JSON string[]
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    receivedAt: text("received_at").notNull(),
    urgencyHint: real("urgency_hint"),
    disposition: text("disposition").notNull().default("new"), // SignalDisposition
    thoughtId: text("thought_id").references(() => thoughts.id),
    directionId: text("direction_id").references(() => directions.id),
    signalKind: text("signal_kind"),   // SignalKind from classifier
    escalateBy: text("escalate_by"),   // ISO-8601, computed at ingest
    dedupeKey: text("dedupe_key").notNull(),
    // Two-sided reply tracking: set when a reply to this thread went out,
    // cleared by replyReceivedAt when the other side answers.
    awaitingReplyAt: text("awaiting_reply_at"),
    replyReceivedAt: text("reply_received_at"),
  },
  (t) => [
    uniqueIndex("signals_dedupe_key_idx").on(t.dedupeKey),
    index("signals_received_at_idx").on(t.receivedAt),
    index("signals_thread_id_idx").on(t.threadId),
  ],
);

// ── thoughts ─────────────────────────────────────────────────────────────────

export const thoughts = sqliteTable("thoughts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  state: text("state").notNull().default("seedling"), // ThoughtState
  directionId: text("direction_id").references(() => directions.id),
  nextAction: text("next_action"),
  reviewAt: text("review_at"),
  escalateBy: text("escalate_by"),   // deadline; checker promotes thought when this passes
  // Commitment JSON (packages/core/src/commitments.ts). States are replaced,
  // previousStates is append-only, so a changed promise keeps its history.
  commitment: text("commitment"),
  // Set when state = disputed: the one thing blocking a safe answer.
  disputedReason: text("disputed_reason"),
  // Set when an outbound reply went out and we are waiting on the other side.
  awaitingReplyAt: text("awaiting_reply_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// ── actions ──────────────────────────────────────────────────────────────────

export const actions = sqliteTable("actions", {
  id: text("id").primaryKey(),
  thoughtId: text("thought_id").references(() => thoughts.id),
  signalId: text("signal_id").references(() => signals.id),
  kind: text("kind").notNull(), // "reply" | "draft"
  payload: text("payload").notNull(), // JSON OutboundDraft
  status: text("status").notNull().default("proposed"), // ActionStatus
  adapter: text("adapter").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  sentAt: text("sent_at"),
}, (t) => [index("actions_status_idx").on(t.status)]);

// ── events (append-only audit log) ───────────────────────────────────────────

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  at: text("at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  actor: text("actor").notNull(), // "system" | "user"
  kind: text("kind").notNull(),
  payload: text("payload").notNull(), // JSON
});
