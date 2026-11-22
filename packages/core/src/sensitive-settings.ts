/**
 * Sensitive topics: subjects where a wrong automatic answer costs too much
 * (legal, money, health, or anything the operator adds).
 *
 * A message that mentions an enabled topic is held for the operator: it cannot
 * be absorbed, drafted, or sent, and becomes a Thought. Matching is on whole
 * words (stemmed), so "surgeries" matches "surgery" but "taxi" does not match
 * "tax". A hold costs a Thought, so every topic can be switched off and the
 * keyword lists are the operator's to edit. Stored in `sensitive.json` in the
 * config directory.
 *
 * The defaults are a starting point, not a classification of risk. They are
 * English and deliberately short.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { configDir, ensureDirs } from "./config.js";

export const SensitiveTopicSchema = z.object({
  /** Shown in the Queue and recorded on the event, e.g. "legal". */
  name: z.string().trim().min(1).max(40),
  /** Words or phrases. Any one in a message triggers the topic. */
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(100),
  enabled: z.boolean(),
});
export type SensitiveTopic = z.infer<typeof SensitiveTopicSchema>;

export const SensitiveSettingsSchema = z
  .object({ topics: z.array(SensitiveTopicSchema).max(30) })
  .superRefine((settings, ctx) => {
    const seen = new Set<string>();
    settings.topics.forEach((topic, i) => {
      const key = topic.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["topics", i, "name"],
          message: `duplicate topic ${topic.name}`,
        });
      }
      seen.add(key);
    });
  });
export type SensitiveSettings = z.infer<typeof SensitiveSettingsSchema>;

export const DEFAULT_SENSITIVE_SETTINGS: SensitiveSettings = {
  topics: [
    {
      name: "legal",
      enabled: true,
      keywords: [
        "lawsuit",
        "attorney",
        "lawyer",
        "subpoena",
        "litigation",
        "legal action",
        "cease and desist",
        "settlement",
        "court order",
      ],
    },
    {
      name: "financial",
      enabled: true,
      keywords: [
        "wire transfer",
        "bank account",
        "routing number",
        "account number",
        "credit card",
        "tax return",
        "mortgage",
        "loan",
        "bankruptcy",
        "payroll",
      ],
    },
    {
      name: "health",
      enabled: true,
      keywords: [
        "diagnosis",
        "surgery",
        "prescription",
        "medication",
        "medical",
        "hospital",
        "cancer",
        "therapy",
        "illness",
      ],
    },
  ],
};

export function sensitiveSettingsPath(): string {
  return join(configDir(), "sensitive.json");
}

/** The operator's list, or the defaults when there is no file or it is invalid. */
export function sensitiveSettings(): SensitiveSettings {
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(sensitiveSettingsPath(), "utf8"));
  } catch {
    return DEFAULT_SENSITIVE_SETTINGS;
  }
  const parsed = SensitiveSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_SENSITIVE_SETTINGS;
}

export function writeSensitiveSettings(settings: SensitiveSettings): void {
  ensureDirs();
  const path = sensitiveSettingsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
