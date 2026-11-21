/**
 * Step 1 — Dedupe.
 * Derives the dedupeKey and checks whether this signal was already ingested.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@mind/core";
import { signals } from "@mind/core";
import type { NewSignal } from "@mind/core";

export function dedupeKey(signal: NewSignal): string {
  // A provider-independent id (mail Message-ID) wins: the same message in two
  // mailboxes has two provider ids but one Message-ID, and one conversation
  // must not become two items just because two accounts received it.
  if (signal.dedupeId) return signal.dedupeId;
  return `${signal.adapter}:${signal.externalId}`;
}

export function isDuplicate(db: Db, key: string): boolean {
  const row = db.select({ id: signals.id }).from(signals).where(eq(signals.dedupeKey, key)).get();
  return row !== undefined;
}
