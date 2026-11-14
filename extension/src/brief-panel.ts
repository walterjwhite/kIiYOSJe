import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { apiFetch } from "./api-client.js";

interface Thought {
  id: string;
  title: string;
  body: string;
  state: string;
  directionId: string | null;
  nextAction: string | null;
  reviewAt: string | null;
  escalateBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Action {
  id: string;
  kind: string;
  status: string;
  adapter: string;
  payload: string;
  signalId: string | null;
}

interface BriefPayload {
  date: string;
  thoughts: {
    active: Thought[];
    overdue: Thought[];
    reviewDue: Thought[];
    newToday: Thought[];
  };
  actions: { proposed: Action[] };
  absorb: { today: number };
  directions: { active: { id: string; name: string; posture: string }[] };
}

export class BriefPanel {
  private static current: BriefPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(context: vscode.ExtensionContext): void {
    if (BriefPanel.current) {
      BriefPanel.current.panel.reveal();
      return;
    }
    BriefPanel.current = new BriefPanel(context);
  }

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "mind.brief",
      "Today — mind",
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    this.panel.onDidDispose(() => {
      BriefPanel.current = undefined;
    });

    // Handle messages posted back from the webview script
    this.panel.webview.onDidReceiveMessage((msg: { command: string }) => {
      if (msg.command === "refresh") {
        this.render().catch((err) =>
          vscode.window.showErrorMessage(String(err)),
        );
      }
    });

    this.render().catch((err) =>
      vscode.window.showErrorMessage(String(err)),
    );
  }

  private async render(): Promise<void> {
    let brief: BriefPayload;
    try {
      brief = await apiFetch<BriefPayload>("/brief");
    } catch (err) {
      this.panel.webview.html = `<body><pre>${String(err)}</pre></body>`;
      return;
    }

    // A fresh nonce per render keeps the CSP narrow while allowing inline scripts.
    const nonce = crypto.randomBytes(16).toString("base64");

    const sections: string[] = [];

    sections.push(`<h1>Today — ${esc(brief.date)}</h1>`);

    // Refresh button — posts back to the extension host
    sections.push(
      `<p><button id="refresh-btn">↺ Refresh</button></p>`,
    );

    // Directions in effect
    sections.push(
      `<section>
        <h2>Directions in effect (${brief.directions.active.length})</h2>
        <ul>${brief.directions.active
          .map((d) => `<li>${esc(d.name)} <span class="posture">${esc(d.posture)}</span></li>`)
          .join("")}</ul>
      </section>`,
    );

    // Overdue — response expected (styled with error foreground)
    if (brief.thoughts.overdue.length > 0) {
      sections.push(
        `<section>
          <h2 class="overdue">Overdue — response expected (${brief.thoughts.overdue.length})</h2>
          <ul class="overdue">${brief.thoughts.overdue
            .map(
              (t) =>
                `<li><strong>${esc(t.title)}</strong>${t.escalateBy ? ` <span class="meta">escalate by ${esc(t.escalateBy)}</span>` : ""}</li>`,
            )
            .join("")}</ul>
        </section>`,
      );
    }

    // Active thoughts
    sections.push(
      `<section>
        <h2>Active thoughts (${brief.thoughts.active.length})</h2>
        <ul>${brief.thoughts.active
          .map((t) => `<li>${esc(t.title)}</li>`)
          .join("")}</ul>
      </section>`,
    );

    // New today
    if (brief.thoughts.newToday.length > 0) {
      sections.push(
        `<section>
          <h2>New today (${brief.thoughts.newToday.length})</h2>
          <ul>${brief.thoughts.newToday
            .map((t) => `<li>${esc(t.title)}</li>`)
            .join("")}</ul>
        </section>`,
      );
    }

    // Review due
    if (brief.thoughts.reviewDue.length > 0) {
      sections.push(
        `<section>
          <h2>Review due (${brief.thoughts.reviewDue.length})</h2>
          <ul>${brief.thoughts.reviewDue
            .map(
              (t) =>
                `<li>${esc(t.title)}${t.reviewAt ? ` <span class="meta">review by ${esc(t.reviewAt)}</span>` : ""}</li>`,
            )
            .join("")}</ul>
        </section>`,
      );
    }

    // Awaiting approval
    sections.push(
      `<section>
        <h2>Awaiting your approval (${brief.actions.proposed.length})</h2>
        ${
          brief.actions.proposed.length > 0
            ? `<p><a href="command:mind.review.focus">open Review panel</a></p>`
            : "<p>Nothing pending.</p>"
        }
      </section>`,
    );

    // Absorbed today
    sections.push(
      `<section>
        <h2>Absorbed today</h2>
        <p>${brief.absorb.today} signal${brief.absorb.today === 1 ? "" : "s"} handled without reaching you.</p>
      </section>`,
    );

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    body    { font-family: var(--vscode-font-family); padding: 1.5em; max-width: 720px; }
    h1      { font-size: 1.3em; margin-bottom: 1em; }
    h2      { font-size: 1em; margin-top: 1.5em; color: var(--vscode-descriptionForeground); }
    ul      { padding-left: 1.2em; }
    .overdue        { color: var(--vscode-errorForeground); }
    .posture        { opacity: 0.7; font-style: italic; font-size: 0.9em; }
    .meta           { opacity: 0.7; font-size: 0.85em; }
    button          { cursor: pointer; padding: 4px 10px; }
  </style>
</head>
<body>
${sections.join("\n")}
<script nonce="${nonce}">
  (function() {
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh-btn').addEventListener('click', function() {
      vscode.postMessage({ command: 'refresh' });
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
