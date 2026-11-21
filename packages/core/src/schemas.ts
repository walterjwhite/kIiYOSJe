/**
 * Zod validators for config, LLM output, and HTTP API.
 */

import { z } from "zod";

/** A malformed request or config value; the server reports it as 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const ScopeKindSchema = z.enum(["person", "project", "topic", "thread"]);
export const DirectionPostureSchema = z.enum(["absorb", "draft", "surface", "escalate"]);
export const DirectionAutonomySchema = z.enum(["observe", "draft", "send"]);
export const ThoughtStateSchema = z.enum([
  "seedling",
  "active",
  "goal",
  "disputed",
  "parked",
  "closed",
]);

export const DirectionGuardsSchema = z.object({
  maxPerThreadPerHour: z.number().int().positive().optional(),
  escalateOn: z.array(z.string()).optional(),
});

/**
 * A button the extension shows on signals matched by a direction. The kinds
 * are a closed set: a YAML file can pick one and configure it, but cannot
 * run commands or make requests.
 *   acknowledge: mark the signal reviewed and close its linked thought.
 *   openLink:    open a link found in the message in the operator's browser.
 *                `linkPrefix` is the exact https URL the link must start with;
 *                the button only appears when the message contains one.
 */
export const SignalActionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    label: z.string().min(1),
    kind: z.literal("acknowledge"),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    label: z.string().min(1),
    kind: z.literal("openLink"),
    linkPrefix: z.string().refine((v) => {
      try {
        const u = new URL(v);
        return (
          u.protocol === "https:" && u.username === "" && u.password === "" && u.pathname.length > 1
        );
      } catch {
        return false;
      }
    }, "must be an https URL with a path, no credentials"),
    confirm: z.string().min(1).optional(),
  }),
]);

export const DirectionConfigSchema = z.preprocess(
  (raw) => {
    // "standard" is the field's internal/DB name, kept for backward
    // compatibility with every existing directions/*.yaml file. "guidance"
    // is the clearer name going forward — it's what the field actually is:
    // guidance for how to recognize and respond, not a formal standard.
    // Either key works in YAML; "standard" still wins if both are present,
    // so nothing silently changes for a file that already has one.
    if (raw && typeof raw === "object" && "guidance" in raw && !("standard" in raw)) {
      const { guidance, ...rest } = raw as Record<string, unknown>;
      return { ...rest, standard: guidance };
    }
    return raw;
  },
  z.object({
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
    // How to rewrite a matched signal's display summary — see
    // types.ts' DirectionConfig.transformPrompt for the full explanation.
    transformPrompt: z.string().optional(),
    // Buttons shown on matched signals in the extension. See SignalActionSchema.
    signalActions: z
      .array(SignalActionSchema)
      .refine((a) => new Set(a.map((x) => x.id)).size === a.length, "action ids must be unique")
      .optional(),
  }),
);

// PATCH /directions/:id — editable fields, all optional.
export const UpdateDirectionRequestSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && "guidance" in raw && !("standard" in raw)) {
      const { guidance, ...rest } = raw as Record<string, unknown>;
      return { ...rest, standard: guidance };
    }
    return raw;
  },
  z.object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    posture: DirectionPostureSchema.optional(),
    autonomy: DirectionAutonomySchema.optional(),
    scopeKind: ScopeKindSchema.optional(),
    // Empty string is a legitimate value here: the system catch-all
    // direction uses scopeKind "topic" + scopeValue "" to mean "matches
    // everything" (see pipeline/fallback-direction.ts). Only reject the
    // field when it's missing, not when it's deliberately blank.
    scopeValue: z.string().optional(),
    confidenceMin: z.number().min(0).max(1).optional(),
    standard: z.string().min(1).optional(),
    matchPrompt: z.string().nullable().optional(),
    responsePrompt: z.string().nullable().optional(),
    transformPrompt: z.string().nullable().optional(),
  }),
);

// PATCH /signals/:id — currently only supports reclassification.
export const ReclassifySignalRequestSchema = z.object({
  directionId: z.string().min(1),
  reason: z.string().optional(),
});

// PUT /signals/:id/thought — link to an existing thought, or create a new
// one from a title if none is given. Distinct from reclassify (which
// corrects a wrong Direction match): this corrects or sets which larger
// item a signal belongs to.
export const LinkThoughtRequestSchema = z.union([
  z.object({ thoughtId: z.string().min(1) }),
  z.object({ title: z.string().min(1) }),
]);

// PUT /admin/notifications — the quiet period window (Foundations §6).
export const QuietPeriodConfigSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
});

// PUT /admin/display — which signal fields/attributes the extension shows.
export const DisplaySettingsSchema = z.object({
  showSubject: z.boolean(),
  showCc: z.boolean(),
  showBcc: z.boolean(),
  preferHtmlBody: z.boolean(),
});

// LLM classifier structured output schema
export const SignalKindSchema = z.enum([
  "question", // sender is asking for information or an answer
  "task", // sender is assigning or requesting work
  "acknowledgement", // sender confirming receipt or saying thanks
  "information", // sender providing info, no action expected
  "event", // a calendar occurrence, not a message
  "other",
]);

export const ClassifierOutputSchema = z.object({
  confidence: z.number().min(0).max(1),
  intent: z.string(),
  signalKind: SignalKindSchema,
  urgency: z.enum(["low", "medium", "high"]),
  commitment: z.string().nullable(),
  /**
   * ISO-8601 datetime the promise is due, when `commitment` is set. Distinct
   * from escalateBy: a promise date is when I owe something, a reply deadline
   * is when an answer is expected. Optional so a model that omits it still
   * produces a valid classification (it falls back to escalateBy at ingest).
   */
  commitmentDueDate: z.string().datetime().nullable().default(null),
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
  /** "goal" creates a Goal the operator is focusing on; the default is a seedling. */
  state: z.enum(["seedling", "goal"]).optional(),
});

export const UpdateThoughtRequestSchema = z.object({
  state: ThoughtStateSchema.optional(),
  nextAction: z.string().nullable().optional(),
  reviewAt: z.string().datetime().nullable().optional(),
});

// POST /events/notes — an operator-written journal note. Distinct from the
// system audit log the rest of /events exposes: a note is free text, dated,
// never tied to a signal/direction/thought, and never generated — just
// something the operator chose to write down for their own later reading.
export const CreateJournalNoteRequestSchema = z.object({
  text: z.string().min(1),
});
// No writes to signals, thoughts, or actions: this answers "what would this
// Direction have caught", which is the question an author actually has.
//
// The id is in the body, not the path, because Direction ids contain slashes
// (`work/boss`, `system/catch-all`) — a path segment cannot carry one.
export const PreviewDirectionRequestSchema = z.object({
  directionId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
  /** Run the real classifier over the would-match samples (slow, capped at 10). */
  classify: z.boolean().optional(),
});
