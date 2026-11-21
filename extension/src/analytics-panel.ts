import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import {
  buildCoverage,
  COVERAGE_LAYOUT,
  COVERAGE_VIEWBOX,
  type CoverageReport,
  shortWeek,
} from "./coverage-model.js";
import { buildFlow, type FlowGraph, type FlowRow } from "./flow-model.js";
import { FLOW_SCRIPT, FLOW_STYLE } from "./flow-script.js";
import { esc, SectionPanel } from "./webview-base.js";

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

/** Weeks the coverage curve can show. The API clamps to 1..52. */
const COVERAGE_WEEKS = [4, 12, 26, 52] as const;

interface SignalRow {
  id: string;
  adapter: string;
  sender: string;
  body: string;
  disposition: string;
  directionId: string | null;
  receivedAt: string;
}

const COVERAGE_STYLE = `
  .cov-wrap { position: relative; margin: 4px 0 6px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--mind-row-alt); }
  .cov { width: 100%; height: auto; display: block; }
  .cov-grid { stroke: var(--vscode-editor-foreground); opacity: 0.12; stroke-width: 1; }
  .cov-axis, .cov-week, .cov-target-label { fill: var(--vscode-descriptionForeground); font-size: 11px; }
  .cov-target { stroke: var(--vscode-descriptionForeground); stroke-dasharray: 4 4; opacity: 0.55; }
  .cov-rate { fill: none; stroke: var(--mind-accent); stroke-width: 2.5; stroke-linejoin: round; }
  .cov-dirs { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.5; stroke-dasharray: 2 3; opacity: 0.8; }
  .cov-dot { fill: var(--mind-accent); stroke: var(--vscode-editor-background); stroke-width: 2; }
  .cov-dot.ok { fill: var(--mind-green); }
  .cov-null { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.5; }
  .cov-unanswered { fill: var(--mind-yellow); opacity: 0.7; }
  .cov-hit { fill: transparent; }
  .cov-wrap g.clickable:hover .cov-hit { fill: color-mix(in srgb, var(--mind-accent) 10%, transparent); }
  .cov-headline { font-size: 1.05em; margin: 0.35em 0 0.1em; }
  .cov-weeks { display: flex; gap: 6px; margin: 2px 0 8px; }
  .cov-weeks button.active { outline: 2px solid var(--mind-accent); outline-offset: 1px; }
  .cov-legend { font-size: 0.85em; opacity: 0.85; margin: 0.2em 0 0.6em; }
  .cov-legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 12px; vertical-align: middle; }
  .cov-legend .sw.first { margin-left: 0; }
  .sw-rate { background: var(--mind-accent); }
  .sw-dirs { background: var(--vscode-descriptionForeground); height: 2px; }
  .sw-un { background: var(--mind-yellow); }
`;

/**
 * Analytics webview — the coverage curve first, because it is the claim;
 * everything below it is supporting evidence. Every direction row, week,
 * channel bar, and day bar is clickable and opens the matching signals
 * below, via the same GET /metrics/signals drill-down endpoint (mockup
 * parity: "entirely interactive", not a static summary). Each drill-down
 * row in turn opens that signal's own detail panel.
 */
export class AnalyticsPanel extends SectionPanel {
  private static current: AnalyticsPanel | undefined;
  private metrics: MetricsPayload | undefined;
  private coverage: CoverageReport | undefined;
  private coverageWeeks = 12;
  private coverageError: string | undefined;
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
      week?: string;
      weeks?: string;
      id?: string;
      disposition?: string;
      window?: string;
    };
    if (m.command === "refresh") this.load();
    else if (m.command === "drilldown") this.drilldown(m);
    else if (m.command === "coverageWeeks" && m.weeks) {
      const weeks = Number(m.weeks);
      this.coverageWeeks = Number.isFinite(weeks) && weeks > 0 ? weeks : 12;
      this.load();
    } else if (m.command === "open" && m.id) {
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

    // The curve is the point of the screen, so a failure here is reported in
    // place rather than blanking the rest of Analytics.
    try {
      this.coverage = await apiFetch<CoverageReport>(
        `/metrics/coverage?weeks=${this.coverageWeeks}`,
      );
      this.coverageError = undefined;
    } catch (err) {
      this.coverageError = String(err);
    }

    this.drilldownLabel = "";
    this.drilldownRows = [];
    this.render();
  }

  private async drilldown(msg: {
    directionId?: string;
    adapter?: string;
    day?: string;
    week?: string;
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
      parts.push(
        this.metrics?.byDirection.find((d) => d.id === msg.directionId)?.name ?? msg.directionId,
      );
    }
    if (msg.disposition) {
      params.set("disposition", msg.disposition);
      parts.push(msg.disposition);
    }
    if (msg.day) {
      params.set("day", msg.day);
      parts.push(msg.day);
    }
    if (msg.week) {
      params.set("week", msg.week);
      parts.push(`week of ${shortWeek(msg.week)}`);
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

  /** The curve: weekly absorb rate against Directions in force, as one SVG. */
  private renderCoverage(): string {
    if (this.coverageError) {
      return `<p class="danger">Coverage curve unavailable.</p>
        <p class="sub">${esc(this.coverageError)}</p>`;
    }
    const report = this.coverage;
    if (!report) return "";

    const c = buildCoverage(report);
    const selector = `<div class="cov-weeks">${COVERAGE_WEEKS.map(
      (w) =>
        `<button data-action="coverageWeeks" data-weeks="${w}"${
          w === this.coverageWeeks ? ' class="active"' : ""
        }>${w}w</button>`,
    ).join("")}</div>`;

    if (!c.hasData) {
      return `<p class="sub">${esc(c.caption)}</p>
        <p class="empty">No signals in the last ${c.weeks} weeks.</p>
        ${selector}`;
    }

    const { width, height } = COVERAGE_VIEWBOX;
    const L = COVERAGE_LAYOUT.left;
    const R = width - COVERAGE_LAYOUT.right;
    const step = c.points.length > 1 ? (R - L) / (c.points.length - 1) : R - L;

    const grid = c.ticks
      .map(
        (t) => `<line class="cov-grid" x1="${L}" x2="${R}" y1="${t.y}" y2="${t.y}"/>
          <text class="cov-axis" x="${L - 10}" y="${t.y + 4}" text-anchor="end">${t.label}</text>`,
      )
      .join("");

    const points = c.points
      .map((p) => {
        const title =
          p.absorbRate == null
            ? `${p.label}: no traffic`
            : `${p.label}: ${Math.round(p.absorbRate * 100)}% absorbed`;
        const detail = `${p.signals} signals · ${p.directions} Directions in force${
          p.absorbedUnanswered > 0 ? ` · ${p.absorbedUnanswered} absorbed, never answered` : ""
        }`;
        return `<g class="clickable" data-action="drilldown" data-week="${esc(p.weekStart)}">
          <title>${esc(title)} — ${esc(detail)}</title>
          <rect class="cov-hit" x="${p.x - step / 2}" y="0" width="${step}" height="${height}"/>
          ${
            p.y != null
              ? `<circle class="cov-dot${p.meetsTarget ? " ok" : ""}" cx="${p.x}" cy="${p.y}" r="3.5"/>`
              : `<circle class="cov-null" cx="${p.x}" cy="${c.baselineY}" r="3"/>`
          }
          <rect class="cov-unanswered" x="${p.x - 5}" y="${
            c.barBaseY - p.unansweredHeight
          }" width="10" height="${p.unansweredHeight}"/>
          <text class="cov-week" x="${p.x}" y="${c.labelY}" text-anchor="middle">${esc(p.label)}</text>
        </g>`;
      })
      .join("");

    return `<p class="cov-headline">${esc(c.headline)}</p>
      <p class="sub">${esc(c.caption)}${
        c.absorbedUnanswered > 0 ? ` · ${c.absorbedUnanswered} absorbed but never answered` : ""
      }</p>
      <p class="cov-legend">
        <span class="sw sw-rate first"></span>absorb rate
        <span class="sw sw-dirs"></span>Directions in force
        <span class="sw sw-un"></span>absorbed, never answered
      </p>
      <div class="cov-wrap">
        <svg class="cov" viewBox="0 0 ${width} ${height}" role="img"
             aria-label="Weekly absorb rate against Directions in force">
          ${grid}
          <line class="cov-target" x1="${L}" x2="${R}" y1="${c.targetY}" y2="${c.targetY}"/>
          <text class="cov-target-label" x="${R}" y="${c.targetY - 5}" text-anchor="end">target ${Math.round(
            c.target * 100,
          )}%</text>
          <path class="cov-dirs" d="${c.directionsPath}"/>
          ${c.rateSegments.map((seg) => `<polyline class="cov-rate" points="${seg}"/>`).join("")}
          ${points}
        </svg>
      </div>
      ${selector}`;
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

    // Every number gets a comparison: a ratio is signals per Thought, and the
    // target is the one threshold the thesis can fail.
    const ratioText = m.ratio != null ? ` · ${m.ratio} signals per Thought` : "";
    const targetText = this.coverage
      ? ` · target ${Math.round((this.coverage.target ?? 0.6) * 100)}% absorbed`
      : "";

    const body = `
      <p class="sub">Window: ${esc(m.window)} · ${m.signals} signals / ${m.thoughts} thoughts${ratioText}${targetText}</p>
      <div class="toolbar"><button data-action="refresh">↺ Refresh</button></div>

      <h2>Coverage</h2>
      ${this.renderCoverage()}

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

    this.panel.webview.html = this.shell(
      "Analytics",
      body,
      `${COVERAGE_STYLE}\n${FLOW_STYLE}`,
      FLOW_SCRIPT,
    );
  }
}
