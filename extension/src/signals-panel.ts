import * as vscode from "vscode";
import { channelLabel } from "./format.js";
import { apiFetch } from "./api-client.js";
import { SectionPanel, esc } from "./webview-base.js";

export type SignalRange = "1h" | "4h" | "12h" | "today" | "7d" | "30d" | "all";

interface Signal {
  id: string;
  adapter: string;
  account: string | null;
  sender: string;
  subject: string | null;
  body: string;
  transformedSummary: string | null;
  disposition: string;
  directionId: string | null;
  receivedAt: string;
}

interface DirectionOption {
  id: string;
  name: string;
}

interface DisplaySettings {
  showSubject: boolean;
}

const RANGE_LABEL: Record<SignalRange, string> = {
  "1h": "Last hour",
  "4h": "Last 4 hours",
  "12h": "Last 12 hours",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All",
};

/**
 * Signals — every signal, inbound and outbound, defaulting to today and
 * widened with the range segmented control, same as the mockup. Replaces
 * the earlier Signals tree view; same GET /signals?range= endpoint.
 */
export class SignalsPanel extends SectionPanel {
  private static current: SignalsPanel | undefined;
  private signals: Signal[] = [];
  private range: SignalRange = "today";
  private showSubject = true;
  private loadError: string | undefined;

  static show(): void {
    if (SignalsPanel.current) {
      SignalsPanel.current.reveal();
      return;
    }
    SignalsPanel.current = new SignalsPanel();
  }

  private constructor() {
    super("mind.signals", "Signals — mind");
    this.load();
  }

  protected onDispose(): void {
    SignalsPanel.current = undefined;
  }

  protected onMessage(msg: unknown): void {
    const m = msg as { command?: string; range?: SignalRange; id?: string };
    if (m.command === "refresh") this.load();
    else if (m.command === "setRange" && m.range) {
      this.range = m.range;
      this.load();
    } else if (m.command === "reclassify" && m.id) {
      this.reclassify(m.id);
    } else if (m.command === "open" && m.id) {
      vscode.commands.executeCommand("mind.signal.open", m.id);
    }
  }

  private async load(): Promise<void> {
    try {
      const [signals, settings] = await Promise.all([
        apiFetch<Signal[]>(`/signals?range=${this.range}`),
        apiFetch<DisplaySettings>("/admin/display"),
      ]);
      this.signals = signals;
      this.showSubject = settings.showSubject;
      this.loadError = undefined;
    } catch (err) {
      this.loadError = String(err);
    }
    this.render();
  }

  private async reclassify(signalId: string): Promise<void> {
    let dirs: DirectionOption[];
    try {
      dirs = await apiFetch<DirectionOption[]>("/directions");
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }

    const picked = await vscode.window.showQuickPick(
      dirs.map((d) => ({ label: d.name, description: d.id, id: d.id })),
      { placeHolder: "Move this signal to which direction?" },
    );
    if (!picked) return;

    const reason = await vscode.window.showInputBox({
      prompt: "Why was the original match wrong? (optional)",
      placeHolder: "e.g. matched on a keyword that doesn't apply here",
    });

    try {
      await apiFetch(`/signals/${signalId}`, {
        method: "PATCH",
        body: JSON.stringify({ directionId: picked.id, reason: reason || undefined }),
      });
      vscode.window.showInformationMessage(`mind: reclassified to ${picked.label}.`);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return;
    }
    this.load();
  }

  private render(): void {
    if (this.loadError) {
      this.panel.webview.html = this.shell(
        "Signals",
        `<p class="danger">Can't reach the mind server.</p>
         <p class="sub">${esc(this.loadError)}</p>
         <button data-action="refresh">↺ Retry</button>`,
      );
      return;
    }

    const rangeButtons = (Object.keys(RANGE_LABEL) as SignalRange[])
      .map(
        (r) =>
          `<button data-action="setRange" data-range="${r}" style="${r === this.range ? "font-weight:700;" : ""}">${RANGE_LABEL[r]}</button>`,
      )
      .join("");

    const rows = this.signals
      .map(
        (s) => `<tr class="clickable" data-action="open" data-id="${esc(s.id)}">
          <td>${esc(channelLabel(s.adapter, s.account))}</td>
          <td>${esc(s.sender)}</td>
          ${this.showSubject ? `<td>${esc(s.subject ?? "—")}</td>` : ""}
          <td>${s.transformedSummary ? esc(s.transformedSummary) + ' <span class="badge">rewritten</span>' : esc(s.body.slice(0, 100))}</td>
          <td>${esc(s.disposition)}</td>
          <td>${esc(s.directionId ?? "—")}</td>
          <td>${esc(s.receivedAt)}</td>
          <td><button data-action="reclassify" data-id="${esc(s.id)}">Reclassify</button></td>
        </tr>`,
      )
      .join("");

    const body = `
      <div class="toolbar">
        ${rangeButtons}
        <button data-action="refresh">↺ Refresh</button>
        <span class="meta">${this.signals.length} signals</span>
      </div>
      ${
        this.signals.length > 0
          ? `<table>
              <thead><tr><th>Channel</th><th>From</th>${this.showSubject ? "<th>Subject</th>" : ""}<th>Body</th><th>Status</th><th>Direction</th><th>Received</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<p class="empty">No signals in this range.</p>'
      }
    `;

    this.panel.webview.html = this.shell("Signals", body);
  }
}
