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
});

// LLM classifier structured output schema
export const ClassifierOutputSchema = z.object({
  directionId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  intent: z.string(),
  urgency: z.enum(["low", "medium", "high"]),
  commitment: z.string().nullable(),
  sensitiveTopics: z.array(z.string()),
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
