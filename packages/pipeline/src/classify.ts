/**
 * Step 4 — Classify.
 * Calls the LLM for structured classification output.
 * Stubbed for P0; real implementation in P2 (needs model provider choice).
 */

import { ClassifierOutputSchema } from "@mind/core";
import type { z } from "zod";

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export interface ClassifyInput {
  signalBody: string;
  sender: string;
  directionId: string | null;
  standard: string | null;
}

/**
 * Stub: returns a low-confidence observe result so the pipeline runs end-to-end
 * without a model provider configured.
 */
export async function classify(input: ClassifyInput): Promise<ClassifierOutput> {
  return {
    directionId: input.directionId,
    confidence: 0,
    intent: "unknown — classifier not yet configured",
    urgency: "low",
    commitment: null,
    sensitiveTopics: [],
  };
}
