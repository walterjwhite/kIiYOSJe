import { describe, expect, it } from "vitest";
import { localOllamaRoot, type RawEvent, shouldReload, summarize } from "../src/trace-model.js";

const call = (operation: string, durationMs: number, extra: Record<string, unknown> = {}) => ({
  operation,
  provider: "ollama",
  model: "qwen3:8b",
  transport: "http",
  endpoint: "http://localhost:11434/v1",
  durationMs,
  ok: true,
  promptChars: 10,
  responseChars: 5,
  ...extra,
});

const ev = (at: string, ai: unknown, signalId = "s1"): RawEvent => ({
  at,
  kind: "signal.processed",
  payload: JSON.stringify({ signalId, ai }),
});

describe("summarize", () => {
  it("counts signals with and without model calls and records skip reasons", () => {
    const s = summarize([
      ev("2026-01-01T10:00:00Z", {
        calls: [call("classify", 100)],
        skipped: { draft: "no draft needed" },
      }),
      ev(
        "2026-01-01T11:00:00Z",
        { calls: [], skipped: { classify: "no AI provider configured" } },
        "s2",
      ),
      { at: "2026-01-01T12:00:00Z", kind: "action.sent", payload: "{}" },
    ]);
    expect(s.signals).toBe(2);
    expect(s.withModel).toBe(1);
    expect(s.withoutModel).toBe(1);
    expect(s.skipped["classify: no AI provider configured"]).toBe(1);
  });

  it("aggregates per operation, model and edge, newest call first", () => {
    const s = summarize([
      ev("2026-01-01T10:00:00Z", { calls: [call("classify", 100), call("draft", 400)] }),
      ev("2026-01-01T11:00:00Z", { calls: [call("classify", 300, { ok: false, error: "boom" })] }),
    ]);
    expect(s.calls[0]!.at).toBe("2026-01-01T11:00:00Z");
    const classify = s.ops.find((o) => o.operation === "classify")!;
    expect(classify).toMatchObject({ count: 2, errors: 1, avgMs: 200, maxMs: 300 });
    expect(s.models).toHaveLength(1);
    expect(s.models[0]).toMatchObject({ count: 3, errors: 1 });
    expect(s.edges.find((e) => e.operation === "draft")).toMatchObject({ count: 1, avgMs: 400 });
  });

  it("sums tokens when present and tolerates malformed payloads", () => {
    const s = summarize([
      ev("2026-01-01T10:00:00Z", {
        calls: [call("classify", 1, { inputTokens: 7, outputTokens: 3 })],
      }),
      { at: "2026-01-01T10:01:00Z", kind: "signal.processed", payload: "not json" },
      ev("2026-01-01T10:02:00Z", undefined),
    ]);
    expect(s.models[0]).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(s.signals).toBe(2);
  });
});

describe("summarize records", () => {
  it("keeps one record per processed signal with its direction, outcome and model time", () => {
    const s = summarize([
      {
        at: "2026-01-01T10:00:00Z",
        kind: "signal.processed",
        payload: JSON.stringify({
          signalId: "s1",
          adapter: "gmail",
          disposition: "promoted",
          directionId: "work/boss",
          matchedBy: "scope:person",
          ai: { calls: [call("classify", 100), call("draft", 50)], modelMs: 150 },
        }),
      },
      ev("2026-01-01T11:00:00Z", { calls: [] }, "s2"),
    ]);
    expect(s.records).toHaveLength(2);
    expect(s.records[1]).toMatchObject({
      signalId: "s1",
      adapter: "gmail",
      disposition: "promoted",
      directionId: "work/boss",
      matchedBy: "scope:person",
      calls: 2,
      modelMs: 150,
    });
    expect(s.records[0]).toMatchObject({
      signalId: "s2",
      calls: 0,
      directionId: null,
      matchedBy: null,
    });
  });
});

describe("localOllamaRoot", () => {
  it("maps an OpenAI-compatible base URL to the Ollama root on local hosts", () => {
    expect(localOllamaRoot("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(localOllamaRoot("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(localOllamaRoot(null)).toBe("http://localhost:11434");
  });
  it("refuses remote hosts and garbage", () => {
    expect(localOllamaRoot("https://api.openai.com/v1")).toBeUndefined();
    expect(localOllamaRoot("nonsense")).toBeUndefined();
  });
});

describe("where a signal went", () => {
  const processed = (signalId: string, disposition: string): RawEvent => ({
    at: "2026-01-01T10:00:00Z",
    kind: "signal.processed",
    payload: JSON.stringify({ signalId, disposition, ai: { calls: [] } }),
  });

  it("names the destination: a linked goal, the Queue, absorbed or filed", () => {
    const s = summarize(
      [
        processed("a", "absorbed"),
        processed("b", "promoted"),
        processed("c", "escalated"),
        processed("d", "promoted"),
        processed("e", "filed"),
      ],
      { d: { id: "g1", title: "Ship Q4 report" } },
    );
    const byId = Object.fromEntries(s.records.map((r) => [r.signalId, r.destination]));
    expect(byId).toEqual({ a: "absorbed", b: "queue", c: "queue", d: "goal:g1", e: "filed" });
    expect(s.destinations.map((d) => [d.key, d.label, d.count])).toEqual([
      ["queue", "Queue", 2],
      ["absorbed", "Absorbed", 1],
      ["filed", "Filed", 1],
      ["goal:g1", "Goal \u00b7 Ship Q4 report", 1],
    ]);
  });

  it("works without any goal information", () => {
    const s = summarize([processed("a", "promoted")]);
    expect(s.records[0]?.destination).toBe("queue");
  });
});

describe("shouldReload", () => {
  it("reloads when a newer event appeared", () => {
    expect(shouldReload("b", "a", 1000, 1500, 60_000)).toBe(true);
  });
  it("does not reload when nothing changed and the data is fresh", () => {
    expect(shouldReload("a", "a", 1000, 1500, 60_000)).toBe(false);
    expect(shouldReload(undefined, undefined, 1000, 1500, 60_000)).toBe(false);
  });
  it("reloads stale data even when nothing changed", () => {
    expect(shouldReload("a", "a", 1000, 61_000, 60_000)).toBe(true);
  });
});
