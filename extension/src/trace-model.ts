/**
 * Model Trace aggregation. Pure, no vscode import, unit-tested.
 *
 * Input is the `signal.processed` events the pipeline writes; each carries
 * `ai.calls` (one entry per model call) and `ai.skipped` (steps that did not
 * call a model, with the reason). This turns them into the numbers behind the
 * Model Trace graph.
 */

export interface RawEvent {
  id?: string;
  at: string;
  kind: string;
  payload: string;
}

export interface TraceCall {
  at: string;
  signalId: string | null;
  operation: string;
  provider: string;
  model: string;
  transport: string;
  endpoint: string | null;
  durationMs: number;
  ok: boolean;
  error?: string;
  promptChars: number;
  responseChars: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OpStat {
  operation: string;
  count: number;
  errors: number;
  avgMs: number;
  maxMs: number;
}

export interface ModelStat {
  key: string;
  provider: string;
  model: string;
  endpoint: string | null;
  count: number;
  errors: number;
  avgMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface EdgeStat {
  operation: string;
  modelKey: string;
  count: number;
  errors: number;
  avgMs: number;
}

/** One processed signal, for the table behind the non-model nodes. */
export interface ProcessedRecord {
  at: string;
  signalId: string | null;
  adapter: string;
  disposition: string;
  directionId: string | null;
  matchedBy: string | null;
  calls: number;
  modelMs: number;
  /** Where the signal ended up: "absorbed", "filed", "queue", "goal:<id>" or "other:<disposition>". */
  destination: string;
  destinationLabel: string;
}

/** One place signals ended up, with how many. */
export interface DestinationStat {
  key: string;
  kind: "absorbed" | "filed" | "queue" | "goal" | "other";
  label: string;
  count: number;
}

/** The goal a signal is linked to now, by signal id. */
export type GoalLinks = Readonly<Record<string, { id: string; title: string }>>;

export function destinationOf(
  disposition: string,
  goal: { id: string; title: string } | undefined,
): Pick<DestinationStat, "key" | "kind" | "label"> {
  if (goal) return { key: `goal:${goal.id}`, kind: "goal", label: `Goal \u00b7 ${goal.title}` };
  switch (disposition) {
    case "absorbed":
      return { key: "absorbed", kind: "absorbed", label: "Absorbed" };
    case "filed":
      return { key: "filed", kind: "filed", label: "Filed" };
    case "promoted":
    case "escalated":
      return { key: "queue", kind: "queue", label: "Queue" };
    default:
      return { key: `other:${disposition}`, kind: "other", label: disposition };
  }
}

export interface TraceSummary {
  /** Newest first. */
  records: ProcessedRecord[];
  /** Where processed signals ended up: non-goal places first, then goals, biggest first. */
  destinations: DestinationStat[];
  signals: number;
  withModel: number;
  withoutModel: number;
  /** "step: reason" to number of signals. */
  skipped: Record<string, number>;
  /** Newest first. */
  calls: TraceCall[];
  ops: OpStat[];
  models: ModelStat[];
  edges: EdgeStat[];
}

export const modelKey = (c: Pick<TraceCall, "provider" | "model" | "endpoint">): string =>
  `${c.provider}|${c.model}|${c.endpoint ?? ""}`;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function parseCall(raw: unknown, at: string, signalId: string | null): TraceCall | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const call: TraceCall = {
    at,
    signalId,
    operation: str(r["operation"], "other"),
    provider: str(r["provider"], "unknown"),
    model: str(r["model"], "unknown"),
    transport: str(r["transport"], "http"),
    endpoint: typeof r["endpoint"] === "string" ? r["endpoint"] : null,
    durationMs: num(r["durationMs"]),
    ok: r["ok"] !== false,
    promptChars: num(r["promptChars"]),
    responseChars: num(r["responseChars"]),
  };
  if (typeof r["error"] === "string") call.error = r["error"];
  if (typeof r["inputTokens"] === "number") call.inputTokens = r["inputTokens"];
  if (typeof r["outputTokens"] === "number") call.outputTokens = r["outputTokens"];
  return call;
}

export function summarize(evts: RawEvent[], goalLinks: GoalLinks = {}): TraceSummary {
  const calls: TraceCall[] = [];
  const records: ProcessedRecord[] = [];
  const skipped: Record<string, number> = {};
  const destinationCounts = new Map<string, DestinationStat>();
  let signals = 0;
  let withModel = 0;

  for (const e of evts) {
    if (e.kind !== "signal.processed") continue;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(e.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    signals++;
    const ai = (p["ai"] ?? {}) as Record<string, unknown>;
    const signalId = typeof p["signalId"] === "string" ? p["signalId"] : null;
    const list = Array.isArray(ai["calls"]) ? (ai["calls"] as unknown[]) : [];
    let any = false;
    let made = 0;
    for (const raw of list) {
      const c = parseCall(raw, e.at, signalId);
      if (c) {
        calls.push(c);
        any = true;
        made++;
      }
    }
    if (any) withModel++;
    const disposition = str(p["disposition"], "unknown");
    const dest = destinationOf(disposition, signalId ? goalLinks[signalId] : undefined);
    const seenDest = destinationCounts.get(dest.key);
    if (seenDest) seenDest.count++;
    else destinationCounts.set(dest.key, { ...dest, count: 1 });
    records.push({
      destination: dest.key,
      destinationLabel: dest.label,
      at: e.at,
      signalId,
      adapter: str(p["adapter"], "unknown"),
      disposition,
      directionId: typeof p["directionId"] === "string" ? p["directionId"] : null,
      matchedBy: typeof p["matchedBy"] === "string" ? p["matchedBy"] : null,
      calls: made,
      modelMs: num(ai["modelMs"]),
    });
    const sk = (ai["skipped"] ?? {}) as Record<string, unknown>;
    for (const [step, why] of Object.entries(sk)) {
      const k = `${step}: ${String(why)}`;
      skipped[k] = (skipped[k] ?? 0) + 1;
    }
  }

  calls.sort((a, b) => b.at.localeCompare(a.at));
  records.sort((a, b) => b.at.localeCompare(a.at));

  const group = <T>(
    keyOf: (c: TraceCall) => string,
    make: (c: TraceCall) => T,
    add: (t: T, c: TraceCall) => void,
  ) => {
    const m = new Map<string, T>();
    for (const c of calls) {
      const k = keyOf(c);
      let t = m.get(k);
      if (!t) {
        t = make(c);
        m.set(k, t);
      }
      add(t, c);
    }
    return [...m.values()];
  };

  interface Acc {
    count: number;
    errors: number;
    totalMs: number;
    maxMs: number;
  }
  const bump = (a: Acc, c: TraceCall) => {
    a.count++;
    if (!c.ok) a.errors++;
    a.totalMs += c.durationMs;
    a.maxMs = Math.max(a.maxMs, c.durationMs);
  };
  const acc = (): Acc => ({ count: 0, errors: 0, totalMs: 0, maxMs: 0 });
  const avg = (a: Acc) => (a.count === 0 ? 0 : Math.round(a.totalMs / a.count));

  const ops = group(
    (c) => c.operation,
    (c) => ({ operation: c.operation, ...acc() }),
    bump,
  ).map((o) => ({
    operation: o.operation,
    count: o.count,
    errors: o.errors,
    avgMs: avg(o),
    maxMs: o.maxMs,
  }));

  const models = group(
    modelKey,
    (c) => ({
      key: modelKey(c),
      provider: c.provider,
      model: c.model,
      endpoint: c.endpoint,
      inputTokens: 0,
      outputTokens: 0,
      ...acc(),
    }),
    (t, c) => {
      bump(t, c);
      t.inputTokens += c.inputTokens ?? 0;
      t.outputTokens += c.outputTokens ?? 0;
    },
  ).map((m) => ({
    key: m.key,
    provider: m.provider,
    model: m.model,
    endpoint: m.endpoint,
    count: m.count,
    errors: m.errors,
    avgMs: avg(m),
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
  }));

  const edges = group(
    (c) => `${c.operation}>${modelKey(c)}`,
    (c) => ({ operation: c.operation, modelKey: modelKey(c), ...acc() }),
    bump,
  ).map((e) => ({
    operation: e.operation,
    modelKey: e.modelKey,
    count: e.count,
    errors: e.errors,
    avgMs: avg(e),
  }));

  const destinations = [...destinationCounts.values()].sort(
    (a, b) =>
      Number(a.kind === "goal") - Number(b.kind === "goal") ||
      b.count - a.count ||
      a.label.localeCompare(b.label),
  );

  return {
    records,
    destinations,
    signals,
    withModel,
    withoutModel: signals - withModel,
    skipped,
    calls,
    ops,
    models,
    edges,
  };
}

/**
 * The Ollama native API root for a configured OpenAI-compatible base URL
 * ("http://localhost:11434/v1" -> "http://localhost:11434"), or undefined
 * when the host is not this machine. Only local hosts are probed, so the
 * probe can never become an extra egress.
 */
export function localOllamaRoot(endpoint: string | null | undefined): string | undefined {
  try {
    const u = new URL(endpoint ?? "http://localhost:11434");
    const local =
      u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return local ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the Model Trace should fetch its full data now. A one-row probe of the
 * newest event is cheap; the full load runs only when that event changed, or
 * when the data is older than maxAgeMs (so a sliding range such as "Last hour"
 * still drops old calls).
 */
export function shouldReload(
  newestId: string | undefined,
  loadedId: string | undefined,
  loadedAt: number,
  now: number,
  maxAgeMs: number,
): boolean {
  return newestId !== loadedId || now - loadedAt >= maxAgeMs;
}
