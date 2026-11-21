/**
 * Shortlist the Goals a message might belong to, before asking the model.
 *
 * The model is shown only the best few candidates instead of every Goal, which
 * keeps the prompt short (faster, and small local models answer better with
 * three choices than twenty-five) and lets the operator's earlier decisions
 * count: a sender or thread already linked to a Goal points back at it.
 *
 * Retrieval is lexical (BM25 over the Goal's title, parent title, notes and the
 * subjects of messages the operator linked to it by hand). No embedding model is
 * needed, so it runs in microseconds and sends nothing anywhere. Pure, no I/O.
 *
 * Trade-off: a message that shares no words with any Goal and has no known
 * sender or thread is never shortlisted, so it stays unlinked. The gate in
 * `chooseLink` treats a wrong link as worse than a missing one, so that is the
 * safe direction to fail.
 */

export interface GoalDoc {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Title of the parent goal when this is a sub-goal. */
  readonly parentTitle: string | null;
}

/** A message the operator linked to a Goal by hand. Automatic links are not exemplars. */
export interface Exemplar {
  readonly goalId: string;
  readonly sender: string;
  readonly subject: string | null;
}

export interface LinkQuery {
  readonly sender: string;
  readonly subject: string | null;
  readonly body: string;
  /** Goals that other messages in the same thread are already linked to. */
  readonly threadGoalIds?: readonly string[];
}

export interface Candidate {
  readonly goal: GoalDoc;
  readonly score: number;
  /** Up to MAX_EXEMPLARS manual links to this Goal, newest first as supplied. */
  readonly exemplars: readonly Exemplar[];
  /** True when the operator has linked a message from this sender to this Goal. */
  readonly sameSender: boolean;
}

export const DEFAULT_CANDIDATES = 3;
export const MAX_EXEMPLARS = 2;

/** Score added per manual link from the same sender (at most two count). */
const SENDER_BOOST = 2;
/** Score added when the same thread is already linked to the Goal. */
const THREAD_BOOST = 6;
const K1 = 1.2;
const B = 0.75;
const BODY_CHARS_IN_QUERY = 1500;
const BODY_CHARS_IN_GOAL = 600;

const STOPWORDS = new Set(
  (
    "the and for are but not you your with this that have from was were will would could should " +
    "there their them then than what when where which who how can has had its our out all any " +
    "about into over under also just please thanks thank regards hello hi dear best"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    // Light plural stripping so "reports" matches "report".
    out.push(raw.length > 4 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** "Ana <ANA@example.com>" and "ana@example.com" are the same sender. */
export function senderKey(sender: string): string {
  const angle = sender.match(/<([^>]+)>/);
  return (angle?.[1] ?? sender).trim().toLowerCase();
}

function termCounts(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** The best `limit` goals for a message, best first. Goals with no signal at all are left out. */
export function rankGoals(
  query: LinkQuery,
  goals: readonly GoalDoc[],
  exemplars: readonly Exemplar[],
  limit: number = DEFAULT_CANDIDATES,
): Candidate[] {
  if (goals.length === 0 || limit <= 0) return [];

  const exemplarsByGoal = new Map<string, Exemplar[]>();
  for (const e of exemplars)
    exemplarsByGoal.set(e.goalId, [...(exemplarsByGoal.get(e.goalId) ?? []), e]);

  // Goal documents. The title counts triple: it is what the operator wrote to name the work.
  const docs = goals.map((g) => {
    const own = exemplarsByGoal.get(g.id) ?? [];
    const tokens = [
      ...tokenize(g.title),
      ...tokenize(g.title),
      ...tokenize(g.title),
      ...tokenize(g.parentTitle ?? ""),
      ...tokenize(g.body.slice(0, BODY_CHARS_IN_GOAL)),
      ...own.flatMap((e) => tokenize(e.subject ?? "")),
    ];
    return { goal: g, counts: termCounts(tokens), length: tokens.length };
  });
  const avgLength = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const docFrequency = new Map<string, number>();
  for (const d of docs)
    for (const t of d.counts.keys()) docFrequency.set(t, (docFrequency.get(t) ?? 0) + 1);

  // Query terms; a word in the subject counts double.
  const weights = new Map<string, number>();
  for (const t of tokenize(query.body.slice(0, BODY_CHARS_IN_QUERY))) weights.set(t, 1);
  for (const t of tokenize(query.subject ?? "")) weights.set(t, 2);

  const from = senderKey(query.sender);
  const thread = new Set(query.threadGoalIds ?? []);

  const ranked: Candidate[] = [];
  for (const d of docs) {
    let score = 0;
    for (const [term, weight] of weights) {
      const tf = d.counts.get(term);
      if (!tf) continue;
      const n = docFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += weight * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avgLength)));
    }
    const own = exemplarsByGoal.get(d.goal.id) ?? [];
    const sameSenderLinks = own.filter((e) => senderKey(e.sender) === from).length;
    score += SENDER_BOOST * Math.min(2, sameSenderLinks);
    if (thread.has(d.goal.id)) score += THREAD_BOOST;
    if (score <= 0) continue;
    ranked.push({
      goal: d.goal,
      score,
      exemplars: own.slice(0, MAX_EXEMPLARS),
      sameSender: sameSenderLinks > 0,
    });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.goal.title.localeCompare(b.goal.title))
    .slice(0, limit);
}
