/**
 * Turns `POST /directions/preview` into the rows the Directions detail screen
 * shows. Pure, no vscode import, unit-tested.
 *
 * The caveat text is part of the model on purpose: a dry run that hides how
 * much of the sample it actually looked at is worse than no dry run at all.
 */

const DAY_MS = 86_400_000;

export interface PreviewSample {
  signalId: string;
  receivedAt: string;
  adapter: string;
  sender: string;
  kind: string;
  disposition: string;
  matchedDirectionId: string | null;
  matchedByFallback: boolean;
  wouldMatch: boolean;
  guardTriggered: boolean;
}

export interface PreviewClassification {
  signalId: string;
  confidence: number;
  signalKind: string;
  answerable: boolean;
  answerBlocker: string | null;
  wouldEscalate: boolean;
  wouldDispute: boolean;
}

export interface PreviewResult {
  directionId: string;
  name: string;
  sampleWindow?: { since: string; limit: number };
  sampled: number;
  wouldMatch: number;
  matchedByFallback: number;
  guardsTriggered: number;
  classification?: PreviewClassification[];
  samples: PreviewSample[];
}

export interface PreviewRow {
  signalId: string;
  day: string;
  sender: string;
  adapter: string;
  disposition: string;
  matched: string;
  wouldMatch: boolean;
  confidence: number | null;
  flags: string[];
}

export interface PreviewView {
  summary: string;
  caption: string;
  rows: PreviewRow[];
  hasMatches: boolean;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildPreview(result: PreviewResult, now: number = Date.now()): PreviewView {
  const classified = result.classification ?? [];
  const byId = new Map(classified.map((c) => [c.signalId, c]));
  const limit = result.sampleWindow?.limit ?? result.sampled;
  const since = result.sampleWindow?.since;
  const days = since ? Math.max(1, Math.round((now - Date.parse(since)) / DAY_MS)) : null;

  const rows: PreviewRow[] = result.samples.map((sample) => {
    const c = byId.get(sample.signalId);
    const flags: string[] = [];
    if (sample.matchedByFallback) flags.push("fell through to catch-all");
    if (sample.guardTriggered) flags.push("guard tripped");
    if (c?.wouldEscalate) flags.push("below confidence");
    if (c?.wouldDispute) flags.push("may need you");
    if (c && !c.answerable && c.answerBlocker) flags.push(`no answer: ${c.answerBlocker}`);
    return {
      signalId: sample.signalId,
      day: sample.receivedAt.slice(0, 10),
      sender: sample.sender,
      adapter: sample.adapter,
      disposition: sample.disposition,
      matched: sample.matchedDirectionId ?? "nothing",
      wouldMatch: sample.wouldMatch,
      confidence: c ? c.confidence : null,
      flags,
    };
  });

  const summary =
    result.sampled === 0
      ? "No stored signals in the sample window."
      : `${result.wouldMatch} of ${plural(result.sampled, "sampled signal")} would match. ` +
        `${result.guardsTriggered} would trip a guard. ` +
        `${result.matchedByFallback} fell through to the catch-all.`;

  const sampleText = `Samples up to ${plural(limit, "stored signal")}${
    days == null ? "" : ` from the past ${plural(days, "day")}`
  }. Nothing is written except one direction.previewed event.`;
  const classifyText =
    classified.length > 0
      ? ` ${plural(classified.length, "match")} classified with the model (capped at 10).`
      : " The model is not called for this preview.";

  return {
    summary,
    caption: sampleText + classifyText,
    rows,
    hasMatches: result.wouldMatch > 0,
  };
}
