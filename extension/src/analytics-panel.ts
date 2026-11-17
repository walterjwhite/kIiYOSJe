import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { apiFetch } from "./api-client.js";

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
 * "entirely interactive", not a static summary).
 */
export class AnalyticsPanel {
  private static current: AnalyticsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private metrics: MetricsPayload | undefined;
  private drilldownLabel = "";
  private drilldownRows: SignalRow[] = [];

  static show(context: vscode.ExtensionContext): void {
    if (AnalyticsPanel.current) {
      AnalyticsPanel.current.panel.reveal();
      return;
    }
    AnalyticsPanel.current = new AnalyticsPanel(context);
  }

  private constructor(_context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "mind.analytics",
      "Analytics — mind",
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    this.panel.onDidDispose(() => {
      AnalyticsPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(
      (msg: { command: string; directionId?: string; adapter?: string; day?: string }) => {
        if (msg.command === "refresh") {
          this.load().catch((err) => vscode.window.showErrorMessage(String(err)));
        } else if (msg.command === "drilldown") {
          this.drilldown(msg).catch((err) =>
            vscode.window.showErrorMessage(String(err)),
          );
        }
      },
    );

    this.load().catch((err) => vscode.window.showErrorMessage(String(err)));
  }

  private async load(): Promise<void> {
    try {
      this.metrics = await apiFetch<MetricsPayload>("/metrics");
    } catch (err) {
      this.panel.webview.html = `<body><pre>${String(err)}</pre></body>`;
      return;
    }
    this.drilldownLabel = "";
    this.drilldownRows = [];
    this.render();
  }

  private async drilldown(msg: {
    directionId?: string;
    adapter?: string;
    day?: string;
  }): Promise<void> {
    const params = new URLSearchParams();
    let label = "";
    if (msg.directionId) {
      params.set("directionId", msg.directionId);
      const dir = this.metrics?.byDirection.find((d) => d.id === msg.directionId);
      label = `${dir?.name ?? msg.directionId} signals`;
    } else if (msg.adapter) {
      params.set("adapter", msg.adapter);
      label = `${msg.adapter} signals`;
    } else if (msg.day) {
      params.set("day", msg.day);
      label = `Signals on ${msg.day}`;
    }

    try {
      this.drilldownRows = await apiFetch<SignalRow[]>(
        `/metrics/signals?${params.toString()}`,
      );
      this.drilldownLabel = `${label} (${this.drilldownRows.length})`;
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.render();
  }

  private render(): void {
    const m = this.metrics;
    if (!m) return;
    const nonce = crypto.randomBytes(16).toString("base64");

    const directionRows = m.byDirection
      .map(
        (d) => `<tr class="clickable" data-kind="direction" data-id="${esc(d.id)}">
          <td>${esc(d.name)}</td><td>${d.signals}</td>
          <td>${d.absorbRate != null ? (d.absorbRate * 100).toFixed(0) + "%" : "—"}</td>
          <td>${d.overrideRate != null ? (d.overrideRate * 100).toFixed(0) + "%" : "—"}</td>
        </tr>`,
      )
      .join("");

    const channelBars = m.byChannel
      .map(
        (ch) => `<div class="bar-row clickable" data-kind="channel" data-id="${esc(ch.adapter)}">
          <span class="bar-label">${esc(ch.adapter)}</span>
          <span class="bar-value">${ch.count}</span>
        </div>`,
      )
      .join("");

    const dayBars = m.dailyVolume
      .map(
        (d) => `<div class="bar-row clickable" data-kind="day" data-id="${esc(d.day)}">
          <span class="bar-label">${esc(d.day)}</span>
          <span class="bar-value">${d.count}</span>
        </div>`,
      )
      .join("");

    const drilldown =
      this.drilldownRows.length > 0 || this.drilldownLabel
        ? `<section>
            <h2>${esc(this.drilldownLabel)}</h2>
            <ul class="drilldown-list">
              ${this.drilldownRows
                .map(
                  (s) =>
                    `<li><strong>${esc(s.sender)}</strong> <span class="meta">${esc(s.adapter)} · ${esc(s.disposition)}</span><br/>${esc(s.body.slice(0, 160))}</li>`,
                )
                .join("")}
            </ul>
          </section>`
        : "";

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    body    { font-family: var(--vscode-font-family); padding: 1.5em; max-width: 760px; }
    h1      { font-size: 1.3em; margin-bottom: 0.2em; }
    h2      { font-size: 1em; margin-top: 1.5em; color: var(--vscode-descriptionForeground); }
    .sub    { opacity: 0.7; font-size: 0.9em; margin-bottom: 1em; }
    table   { border-collapse: collapse; width: 100%; }
    th, td  { text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--vscode-widget-border); }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: var(--vscode-list-hoverBackground); }
    .bar-row { display: flex; justify-content: space-between; padding: 4px 10px; cursor: pointer; border-bottom: 1px solid var(--vscode-widget-border); }
    .bar-row:hover { background: var(--vscode-list-hoverBackground); }
    .bar-label { opacity: 0.9; }
    .bar-value { font-weight: 600; }
    .drilldown-list { padding-left: 1.2em; }
    .drilldown-list li { margin-bottom: 0.6em; }
    .meta   { opacity: 0.7; font-size: 0.85em; }
    button  { cursor: pointer; padding: 4px 10px; margin-bottom: 1em; }
  </style>
</head>
<body>
  <h1>Analytics</h1>
  <p class="sub">Window: ${esc(m.window)} · ${m.signals} signals / ${m.thoughts} thoughts${m.ratio != null ? ` · ratio ${m.ratio}` : ""}</p>
  <button id="refresh-btn">↺ Refresh</button>

  <h2>By direction — click a row for its signals</h2>
  <table>
    <thead><tr><th>Direction</th><th>Signals</th><th>Absorb rate</th><th>Override rate</th></tr></thead>
    <tbody>${directionRows}</tbody>
  </table>

  <h2>By channel — click a bar for its signals</h2>
  ${channelBars || "<p>No signals yet.</p>"}

  <h2>Daily volume — click a bar for that day's signals</h2>
  ${dayBars || "<p>No signals yet.</p>"}

  ${drilldown}

<script nonce="${nonce}">
  (function() {
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh-btn').addEventListener('click', function() {
      vscode.postMessage({ command: 'refresh' });
    });
    document.querySelectorAll('.clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        const kind = el.getAttribute('data-kind');
        const id = el.getAttribute('data-id');
        if (kind === 'direction') vscode.postMessage({ command: 'drilldown', directionId: id });
        else if (kind === 'channel') vscode.postMessage({ command: 'drilldown', adapter: id });
        else if (kind === 'day') vscode.postMessage({ command: 'drilldown', day: id });
      });
    });
  })();
</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
