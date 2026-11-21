import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { navCommandFor, navHtml } from "./nav-view.js";

/**
 * The sidebar: a short list of section links (Queue, Signals, Directions,
 * Learnings, Analytics, Journal, Devices, Settings) plus one collapsed
 * Developer group for System Events and Model Trace, and nothing else. Each
 * click opens that section as its own webview panel in the editor area, where
 * the full detail lives, so the sidebar shows nothing until you ask.
 *
 * Model Trace and System Events answer "what did the machine do", not "what
 * needs me", so they sit behind the collapsed group rather than on the default
 * path. The structure lives in nav-items.ts and the page in nav-view.ts, so
 * both can be tested without vscode.
 *
 * It is a webview view, not a tree view, so that rows can take a color on hover.
 */
export class NavProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = navHtml(crypto.randomBytes(16).toString("base64"));
    view.webview.onDidReceiveMessage((message: unknown) => {
      const m = message as { command?: unknown; id?: unknown };
      if (m.command !== "open") return;
      const command = navCommandFor(m.id);
      if (command) void vscode.commands.executeCommand(command);
    });
  }
}
