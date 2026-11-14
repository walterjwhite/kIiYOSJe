import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

interface BriefPayload {
  date: string;
  thoughts: { active: unknown[]; reviewDue: unknown[]; escalatedToday: unknown[] };
  actions: { proposed: unknown[] };
  absorb: { today: number };
  directions: { active: { id: string; name: string }[] };
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
      { enableScripts: false },
    );

    this.panel.onDidDispose(() => {
      BriefPanel.current = undefined;
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

    const sections: string[] = [];

    sections.push(`<h1>Today — ${brief.date}</h1>`);

    sections.push(
      `<section>
        <h2>Directions in effect (${brief.directions.active.length})</h2>
        <ul>${brief.directions.active.map((d) => `<li>${esc(d.name)}</li>`).join("")}</ul>
      </section>`,
    );

    sections.push(
      `<section>
        <h2>Actions awaiting approval (${brief.actions.proposed.length})</h2>
        <p>Open the <strong>Review</strong> panel to approve or discard.</p>
      </section>`,
    );

    sections.push(
      `<section>
        <h2>Thoughts needing a decision (${brief.thoughts.active.length})</h2>
      </section>`,
    );

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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none';">
  <style>
    body { font-family: var(--vscode-font-family); padding: 1.5em; max-width: 720px; }
    h1   { font-size: 1.3em; margin-bottom: 1em; }
    h2   { font-size: 1em; margin-top: 1.5em; color: var(--vscode-descriptionForeground); }
    ul   { padding-left: 1.2em; }
  </style>
</head>
<body>${sections.join("\n")}</body>
</html>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
