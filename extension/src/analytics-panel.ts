import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { buildFlow, type FlowGraph, type FlowRow } from "./flow-model.js";
import { FLOW_SCRIPT, FLOW_STYLE } from "./flow-script.js";
import { SectionPanel, esc } from "./webview-base.js";

interface DirectionMetric {
  id: string;
  name: string;
  signals: number;
  absorbed: number;
  absorbRate: number | null;
  overrides: number;
  overrideRate: number | null;
}

interface ChannelMetric {
  adapter: string;
  count: number;
}

interface DailyMetric {
  day: string;
  count: number;
}

interface MetricsPayload {
  window: string;
  signals: number;
  thoughts: number;
  ratio: number | null;
  absorbed: number;
  absorbRate: number | null;
  overrideRate: number | null;
  avgTimeToDecisionMs: number | null;
  sendsWithoutRevert: number;
  byDirection: DirectionMetric[];
  byChannel: ChannelMetric[];
  dailyVolume: DailyMetric[];
}

/** The flow diagram covers the same window as the summary numbers above it. */
const FLOW_WINDOW = "7d";

interface SignalRow {
  id: string;
  adapter: string;
  sender: string;
  body: string;
  disposition: string;
  directionId: string | null;
  receivedAt: string;
}

/**
 * Analytics webview — every direction row, channel bar, and day bar is
 * clickable and opens the matching signals below, via the same
 * GET /metrics/signals drill-down endpoint for all three (mockup parity:
 * "entirely interactive", not a static summary). Each drill-down row in
 * turn opens that signal's own detail panel.
 */
export class AnalyticsPanel extends SectionPanel {
  private static current: AnalyticsPanel | undefined;
  private metrics: MetricsPayload | undefined;
  private flow: FlowGraph = buildFlow([]);
  private drilldownLabel = "";
  private drilldownRows: SignalRow[] = [];
  private loadError: string | undefined;

  static show(): void {
    if (AnalyticsPanel.current) {
      AnalyticsPanel.current.reveal();
      return;
    }
    AnalyticsPanel.current = new AnalyticsPanel();
  }

  private constructor() {
    super("mind.analytics", "Analytics — mind");
    this.load();
  }

  protected onDispose(): void {
    AnalyticsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as {
      command?: string;
      directionId?: string;
      adapter?: string;
      day?: string;
      id?: string;
      disposition?: string;
      window?: string;
    };
    if (m.command === "refresh") this.load();
    else if (m.command === "drilldown") this.drilldown(m);
    else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      this.metrics = await apiFetch<MetricsPayload>(`/metrics?window=${FLOW_WINDOW}`);
      const flow = await apiFetch<{ links: FlowRow[] }>(`/metrics/flow?window=${FLOW_WINDOW}`);
      this.flow = buildFlow(flow.links);
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.drilldownLabel = "";
    this.drilldownRows = [];
    this.render();
  }

  private async drilldown(msg: {
    directionId?: string;
    adapter?: string;
    day?: string;
    disposition?: string;
    window?: string;
  }): Promise<void> {
    const params = new URLSearchParams();
    const parts: string[] = [];
    if (msg.adapter) {
      params.set("adapter", msg.adapter);
      parts.push(msg.adapter);
    }
    if (msg.directionId) {
      params.set("directionId", msg.directionId);
      parts.push(this.metrics?.byDirection.find((d) => d.id === msg.directionId)?.name ?? msg.directionId);
    }
    if (msg.disposition) {
      params.set("disposition", msg.disposition);
      parts.push(msg.disposition);
    }
    if (msg.day) {
      params.set("day", msg.day);
      parts.push(msg.day);
    }
    // Only the diagram sends a window, so the list matches the numbers it shows.
    if (msg.window === FLOW_WINDOW) params.set("window", FLOW_WINDOW);
    const label = `${parts.join(" · ")} signals`;

    try {
      this.drilldownRows = await apiFetch<SignalRow[]>(`/metrics/signals?${params.toString()}`);
      this.drilldownLabel = `${label} (${this.drilldownRows.length})`;
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.render();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Analytics",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const m = this.metrics;
    if (!m) return;

    const directionRows = m.byDirection
      .map(
        (d) => `<tr class="clickable" data-action="drilldown" data-direction-id="${esc(d.id)}">
          <td>${esc(d.name)}</td><td>${d.signals}</td>
          <td>${d.absorbRate != null ? (d.absorbRate * 100).toFixed(0) + "%" : "—"}</td>
          <td>${d.overrideRate != null ? (d.overrideRate * 100).toFixed(0) + "%" : "—"}</td>
        </tr>`,
      )
      .join("");

    const maxDay = Math.max(1, ...m.dailyVolume.map((d) => d.count));
    const dayBars = m.dailyVolume
      .map(
        (d) => `<div class="bar-row clickable" data-action="drilldown" data-day="${esc(d.day)}">
          <span class="bar-label">${esc(d.day)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(d.count / maxDay) * 100}%"></div></div>
          <span class="bar-value">${d.count}</span>
        </div>`,
      )
      .join("");

    const drilldown =
      this.drilldownRows.length > 0 || this.drilldownLabel
        ? `<h2>${esc(this.drilldownLabel)}</h2>
           <table>
             <thead><tr><th>From</th><th>Channel</th><th>Status</th><th>Body</th></tr></thead>
             <tbody>
               ${this.drilldownRows
                 .map(
                   (s) => `<tr class="clickable" data-action="open" data-id="${esc(s.id)}">
                     <td>${esc(s.sender)}</td>
                     <td>${esc(s.adapter)}</td>
                     <td>${esc(s.disposition)}</td>
                     <td>${esc(s.body.slice(0, 120))}</td>
                   </tr>`,
                 )
                 .join("")}
             </tbody>
           </table>`
        : "";

    // Embedded as inert JSON; "<" is escaped so the data cannot close the tag.
    const flowJson = JSON.stringify({ ...this.flow, window: FLOW_WINDOW }).replace(/</g, "\\u003c");

    const body = `
      <p class="sub">Window: ${esc(m.window)} · ${m.signals} signals / ${m.thoughts} thoughts${m.ratio != null ? ` · ratio ${m.ratio}` : ""}</p>
      <div class="toolbar"><button data-action="refresh">↺ Refresh</button></div>

      <h2>By direction</h2>
      <table>
        <thead><tr><th>Direction</th><th>Signals</th><th>Absorb rate</th><th>Override rate</th></tr></thead>
        <tbody>${directionRows}</tbody>
      </table>

      <h2>Flow</h2>
      <div id="flow-wrap">
        <svg id="flow" viewBox="0 0 900 240" role="img" aria-label="Signals by channel, direction and outcome"></svg>
        <div id="flow-tip"></div>
      </div>
      <script type="application/json" id="flow-data">${flowJson}</script>

      <h2>Daily volume</h2>
      ${dayBars || '<p class="empty">No signals yet.</p>'}

      ${drilldown}
    `;

    this.panel.webview.html = this.shell("Analytics", body, FLOW_STYLE, FLOW_SCRIPT);
  }
}
