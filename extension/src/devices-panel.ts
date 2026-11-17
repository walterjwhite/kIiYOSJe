import * as vscode from "vscode";
import * as crypto from "node:crypto";

/**
 * Devices placeholder — PLAN.md §5 ("Several clients, one person") and the
 * future Android app depend on real multi-device pairing and scoped,
 * per-device auth tokens, which conflicts with nothing built yet: PLAN.md's
 * own open decisions defer remote authentication to P6, and there is no
 * second client to pair today. Rather than build that subsystem now for
 * nothing to use, this reuses the mockup's Devices table/pairing-panel
 * layout as a static preview and says plainly that pairing isn't real yet.
 *
 * When the Android app is actually built, this panel is where real pairing
 * (device registry, scoped tokens, revoke-per-device) gets wired in.
 */
export class DevicesPanel {
  private static current: DevicesPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(context: vscode.ExtensionContext): void {
    if (DevicesPanel.current) {
      DevicesPanel.current.panel.reveal();
      return;
    }
    DevicesPanel.current = new DevicesPanel(context);
  }

  private constructor(_context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "mind.devices",
      "Devices — mind",
      vscode.ViewColumn.One,
      { enableScripts: false },
    );

    this.panel.onDidDispose(() => {
      DevicesPanel.current = undefined;
    });

    this.render();
  }

  private render(): void {
    const nonce = crypto.randomBytes(16).toString("base64");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style nonce="${nonce}">
    body    { font-family: var(--vscode-font-family); padding: 1.5em; max-width: 720px; }
    h1      { font-size: 1.3em; margin-bottom: 0.3em; }
    .notice {
      background: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 1.2em;
      font-size: 0.95em;
    }
    .sub    { opacity: 0.75; font-size: 0.9em; margin-bottom: 1.2em; }
    table   { border-collapse: collapse; width: 100%; margin-bottom: 1.2em; }
    th, td  { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border); font-size: 0.92em; }
    th      { opacity: 0.7; text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.3px; }
    .scopes { opacity: 0.85; }
    button  { opacity: 0.5; cursor: not-allowed; padding: 5px 12px; }
    .pairing-panel {
      border: 1px dashed var(--vscode-widget-border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-top: 0.5em;
      opacity: 0.8;
    }
    .pairing-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 4px;
      text-align: center;
      padding: 10px 0;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <h1>Devices</h1>
  <div class="notice">
    <strong>Development in progress.</strong> Device pairing is not
    implemented yet — this is a preview of the planned layout, not live
    data. Settings, queue, journal, and knowledge belong to you, not the
    device; pairing a device will give it its own credential and a scoped
    set of permissions, and revoking one will be immediate and independent
    of the others (PLAN.md §5). This is also where the eventual Android
    app will be paired, once it exists.
  </div>
  <p class="sub">Paired clients (preview)</p>
  <table>
    <thead><tr><th>Name</th><th>Kind</th><th>Paired</th><th>Last seen</th><th>Scopes</th></tr></thead>
    <tbody>
      <tr>
        <td>This editor (VS Code)</td>
        <td>editor</td>
        <td>—</td>
        <td>now</td>
        <td class="scopes">read, capture, send, render, settings</td>
      </tr>
    </tbody>
  </table>
  <button disabled>+ Pair a new device</button>
  <div class="pairing-panel">
    <div class="pairing-code">123 456</div>
    <p class="sub" style="margin-bottom:0;">
      Example only — pairing codes, device scopes, and revocation aren't
      wired to anything real yet.
    </p>
  </div>
</body>
</html>`;
  }
}
