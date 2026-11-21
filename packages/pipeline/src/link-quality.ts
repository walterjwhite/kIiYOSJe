/**
 * How often an automatic goal link turns out to be wrong.
 *
 * An automatic link counts as corrected when the operator later unlinks the
 * signal or moves it to a different goal. Linking it to the same goal by hand
 * is a confirmation, not a correction. This is the link-level counterpart of
 * the false-absorb rate in `ai-quality.md`: a confident wrong decision the
 * operator had to undo. It undercounts, because a wrong link nobody notices is
 * never corrected. Pure, no I/O.
 */

export interface LinkEvent {
  readonly at: string;
  readonly actor: string;
  readonly kind: string;
  readonly payload: string;
}

export interface LinkQuality {
  readonly autoLinks: number;
  readonly corrected: number;
  /** corrected / autoLinks, or null when there were no automatic links. */
  readonly rate: number | null;
  /** Prompt version "1" means a link recorded before versions were stored. */
  readonly byPromptVersion: Record<string, { autoLinks: number; corrected: number }>;
}

interface Parsed {
  readonly signalId: string;
  readonly thoughtId: string | null;
  readonly auto: boolean;
  readonly version: string;
}

function parse(e: LinkEvent): Parsed | null {
  try {
    const p = JSON.parse(e.payload) as Record<string, unknown>;
    if (typeof p["signalId"] !== "string") return null;
    return {
      signalId: p["signalId"],
      thoughtId: typeof p["thoughtId"] === "string" ? p["thoughtId"] : null,
      auto: p["auto"] === true,
      version: typeof p["promptVersion"] === "number" ? String(p["promptVersion"]) : "1",
    };
  } catch {
    return null;
  }
}

export function linkCorrections(events: readonly LinkEvent[]): LinkQuality {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const byPromptVersion: Record<string, { autoLinks: number; corrected: number }> = {};
  let autoLinks = 0;
  let corrected = 0;

  sorted.forEach((event, i) => {
    if (event.kind !== "signal.thought_linked") return;
    const link = parse(event);
    if (!link?.auto || !link.thoughtId) return;
    const bucket = byPromptVersion[link.version] ?? { autoLinks: 0, corrected: 0 };
    byPromptVersion[link.version] = bucket;
    autoLinks++;
    bucket.autoLinks++;
    const undone = sorted.slice(i + 1).some((later) => {
      const next = parse(later);
      if (!next || next.signalId !== link.signalId) return false;
      if (later.kind === "signal.thought_unlinked") return true;
      return later.kind === "signal.thought_linked" && next.thoughtId !== link.thoughtId;
    });
    if (undone) {
      corrected++;
      bucket.corrected++;
    }
  });

  return {
    autoLinks,
    corrected,
    rate: autoLinks > 0 ? +(corrected / autoLinks).toFixed(4) : null,
    byPromptVersion,
  };
}
