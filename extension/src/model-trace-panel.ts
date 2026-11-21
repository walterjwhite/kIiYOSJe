import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { localOllamaRoot, summarize, type RawEvent, type TraceSummary } from "./trace-model.js";
import { TRACE_SCRIPT, TRACE_STYLE } from "./trace-script.js";
import { SectionPanel, esc } from "./webview-base.js";

type TraceRange = "1h" | "4h" | "12h" | "today" | "7d" | "30d";

const RANGE_LABEL: Record<TraceRange, string> = {
  "1h": "Last hour",
  "4h": "Last 4 hours",
  "12h": "Last 12 hours",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

const LIVE_INTERVAL_MS = 3000;

/**
 * Model Trace — an interactive graph of where model calls go. Built from the
 * `ai.calls` recorded on every signal.processed event, so it shows what
 * actually happened rather than what is configured. The "Check Ollama" button
 * also asks a local Ollama server which models are installed and loaded.
 */
export class ModelTracePanel extends SectionPanel {
  private static current: ModelTracePanel | undefined;
  private range: TraceRange = "today";
  private live = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private summary: TraceSummary | undefined;
  private loadError: string | undefined;

  static show(): void {
    if (ModelTracePanel.current) {
      ModelTracePanel.current.reveal();
      return;
    }
    ModelTracePanel.current = new ModelTracePanel();
  }

  private constructor() {
    super("mind.modelTrace", "Model Trace — mind");
    this.renderShell();
  }

  protected onDispose(): void {
    if (this.timer) clearInterval(this.timer);
    ModelTracePanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; range?: TraceRange; id?: string };
    if (m.command === "ready" || m.command === "refresh") void this.load();
    else if (m.command === "setRange" && m.range && m.range in RANGE_LABEL) {
      this.range = m.range;
      this.renderShell();
    } else if (m.command === "toggleLive") this.setLive(!this.live);
    else if (m.command === "ping") void this.ping();
    else if (m.command === "open" && m.id) vscode.commands.executeCommand("mind.signal.open", m.id);
  }

  private setLive(on: boolean): void {
    this.live = on;
    if (this.timer) clearInterval(this.timer);
    this.timer = on ? setInterval(() => void this.load(), LIVE_INTERVAL_MS) : undefined;
    this.renderShell();
  }

  private async load(): Promise<void> {
    try {
      const events = await apiFetch<RawEvent[]>(
        `/events?kind=signal.processed&range=${this.range}&limit=1000`,
      );
      this.summary = summarize(events);
      this.loadError = undefined;
      void this.panel.webview.postMessage({ type: "data", summary: this.summary, live: this.live });
    } catch (err) {
      this.loadError = String(err);
      void this.panel.webview.postMessage({ type: "ping", result: { lines: [{ text: this.loadError, bad: true }] } });
    }
  }

  /** Asks a local Ollama server what is installed and loaded. Remote hosts are never contacted. */
  private async ping(): Promise<void> {
    const lines: { text: string; bad?: boolean }[] = [];
    const used = [...new Set((this.summary?.calls ?? []).map((c) => c.model))];
    const endpoint = this.summary?.calls[0]?.endpoint ?? null;
    const root = localOllamaRoot(endpoint);
    if (!root) {
      lines.push({ text: `The configured endpoint (${endpoint ?? "none"}) is not on this machine, so it was not contacted.`, bad: true });
    } else {
      try {
        const get = async <T>(p: string): Promise<T> => {
          const res = await fetch(root + p, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as T;
        };
        const tags = await get<{ models?: { name: string }[] }>("/api/tags");
        const ps = await get<{ models?: { name: string; size_vram?: number; expires_at?: string }[] }>("/api/ps");
        const installed = (tags.models ?? []).map((m) => m.name);
        lines.push({ text: `Ollama is answering at ${root}.` });
        lines.push({ text: `Installed: ${installed.join(", ") || "nothing"}` });
        const running = ps.models ?? [];
        lines.push({
          text: running.length
            ? `Loaded in memory now: ${running.map((m) => m.name + (m.size_vram ? " (on GPU)" : " (CPU)")).join(", ")}`
            : "No model is loaded right now. Ollama unloads idle models after a few minutes, so this is normal when nothing ran recently.",
        });
        for (const m of used) {
          if (!installed.includes(m)) lines.push({ text: `Model "${m}" appears in recent calls but is not installed.`, bad: true });
        }
      } catch (err) {
        lines.push({ text: `Could not reach Ollama at ${root}: ${String(err)}`, bad: true });
      }
    }
    void this.panel.webview.postMessage({ type: "ping", result: { lines } });
  }

  private renderShell(): void {
    const rangeButtons = (Object.keys(RANGE_LABEL) as TraceRange[])
      .map(
        (r) =>
          `<button data-action="setRange" data-range="${r}" style="${r === this.range ? "font-weight:700;" : ""}">${RANGE_LABEL[r]}</button>`,
      )
      .join("");
    const body = `
      <p class="sub">Every model call mind made, drawn from the audit log. Hover a node or line for numbers, click to filter the calls below. Line thickness is call count, line speed is latency, red means failures.</p>
      <div class="toolbar">
        ${rangeButtons}
        <button data-action="refresh">↺ Refresh</button>
        <button id="replay">▶ Replay</button>
        <button data-action="toggleLive" class="${this.live ? "live-on" : ""}">${this.live ? "● Live" : "○ Live"}</button>
        <button data-action="ping">Check Ollama</button>
      </div>
      <div id="verdict"><strong></strong></div>
      <div id="stats" class="stats"></div>
      <div id="graph-wrap">
        <svg id="graph" viewBox="0 0 960 340" role="img" aria-label="Model call flow graph"></svg>
        <div id="tip"></div>
      </div>
      <div id="ping" class="meta"></div>
      <div id="detail"></div>
      <div id="calls"></div>
      <noscript>${esc("Scripts are disabled.")}</noscript>
    `;
    this.panel.webview.html = this.shell("Model Trace", body, TRACE_STYLE, TRACE_SCRIPT);
  }
}
