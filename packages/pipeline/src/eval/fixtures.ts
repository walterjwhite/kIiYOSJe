/**
 * Labelled evaluation fixtures (`.kiro/specs/eval-harness`).
 *
 * Every fixture is synthetic: `.test` domains, invented text. The recorded
 * classifier output is the real `ClassifierOutputSchema`, so a schema change
 * breaks the fixtures loudly instead of silently skewing a report.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClassifierOutputSchema } from "@mind/core";
import { z } from "zod";

export const FixtureSchema = z.object({
  id: z.string().min(1),
  /** What this case checks, for a human reading the file. */
  note: z.string().min(1),
  signal: z.object({
    sender: z.string().min(1),
    subject: z.string().nullable().default(null),
    body: z.string().min(1),
    threadId: z.string().nullable().default(null),
  }),
  recorded: z.object({
    classifier: ClassifierOutputSchema,
    /** The draft the model would have written. Null for cases that never draft. */
    draft: z.string().nullable().default(null),
  }),
  expected: z.object({
    /** The Direction id that should match; `system/catch-all` when none should. */
    directionId: z.string().min(1),
    /** Whether a human would want to see this signal as a Thought. */
    surfaced: z.boolean(),
  }),
  /** Why the pipeline is known to disagree with the label. Excluded from the floors. */
  known: z.string().nullable().default(null),
});
export type Fixture = z.infer<typeof FixtureSchema>;

const FixtureFileSchema = z.array(FixtureSchema).superRefine((fixtures, ctx) => {
  const seen = new Set<string>();
  fixtures.forEach((f, i) => {
    if (seen.has(f.id)) {
      ctx.addIssue({ code: "custom", path: [i, "id"], message: `duplicate fixture id ${f.id}` });
    }
    seen.add(f.id);
  });
});

/** `packages/pipeline/eval`, the same from `src/eval` and `dist/eval`. */
export function evalDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval");
}

/** Parse fixture JSON. Throws an Error that names the source and the first problem. */
export function parseFixtures(text: string, source: string): Fixture[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: not valid JSON (${(err as Error).message})`);
  }
  const parsed = FixtureFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issue.path.join(".") : "";
    throw new Error(`${source}: ${where ? `${where}: ` : ""}${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

export function loadFixtures(path = join(evalDataDir(), "fixtures.json")): Fixture[] {
  return parseFixtures(readFileSync(path, "utf8"), path);
}
