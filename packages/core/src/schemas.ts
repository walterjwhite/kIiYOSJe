/**
 * Zod validators for config, LLM output, and HTTP API.
 */

import { z } from "zod";

export const ScopeKindSchema = z.enum(["person", "project", "topic", "thread"]);
export const DirectionPostureSchema = z.enum([
  "absorb",
  "draft",
  "surface",
  "escalate",
]);
export const DirectionAutonomySchema = z.enum(["observe", "draft", "send"]);
export const ThoughtStateSchema = z.enum([
  "seedling",
  "active",
  "parked",
  "closed",
]);

export const DirectionGuardsSchema = z.object({
  maxPerThreadPerHour: z.number().int().positive().optional(),
  escalateOn: z.array(z.string()).optional(),
});

export const DirectionConfigSchema = z.object({
  name: z.string().min(1),
  scope: z.object({
    kind: ScopeKindSchema,
    value: z.string().min(1),
  }),
  posture: DirectionPostureSchema,
  autonomy: DirectionAutonomySchema,
  confidenceMin: z.number().min(0).max(1).default(0.7),
  standard: z.string().min(1),
  guards: DirectionGuardsSchema.optional(),
  // How to recognize a match beyond the literal scope value, and how to
  // actually respond. Both optional for backward compatibility with
  // existing YAML files that only set scope/standard.
  matchPrompt: z.string().optional(),
  responsePrompt: z.string().optional(),
});

// PATCH /directions/:id — editable fields, all optional.
export const UpdateDirectionRequestSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  posture: DirectionPostureSchema.optional(),
  autonomy: DirectionAutonomySchema.optional(),
  confidenceMin: z.number().min(0).max(1).optional(),
  standard: z.string().min(1).optional(),
  matchPrompt: z.string().nullable().optional(),
  responsePrompt: z.string().nullable().optional(),
});

// PATCH /signals/:id — currently only supports reclassification.
export const ReclassifySignalRequestSchema = z.object({
  directionId: z.string().min(1),
  reason: z.string().optional(),
});

// PUT /admin/notifications — the quiet period window (Foundations §6).
export const QuietPeriodConfigSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
});

// LLM classifier structured output schema
export const SignalKindSchema = z.enum([
  "question",   // sender is asking for information or an answer
  "task",       // sender is assigning or requesting work
  "acknowledgement", // sender confirming receipt or saying thanks
  "information",    // sender providing info, no action expected
  "event",          // a calendar occurrence, not a message
  "other",
]);

export const ClassifierOutputSchema = z.object({
  confidence: z.number().min(0).max(1),
  intent: z.string(),
  signalKind: SignalKindSchema,
  urgency: z.enum(["low", "medium", "high"]),
  commitment: z.string().nullable(),
  /** ISO-8601 datetime by which a reply is expected, or null. */
  escalateBy: z.string().datetime().nullable(),
  sensitiveTopics: z.array(z.string()),
  /** Whether the system believes it can answer without human input. */
  answerable: z.boolean(),
  /** If answerable=false, what specifically needs human judgement. */
  answerBlocker: z.string().nullable(),
});

// HTTP request/response schemas
export const CreateThoughtRequestSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  directionId: z.string().nullable(),
});

export const UpdateThoughtRequestSchema = z.object({
  state: ThoughtStateSchema.optional(),
  nextAction: z.string().nullable().optional(),
  reviewAt: z.string().datetime().nullable().optional(),
});
