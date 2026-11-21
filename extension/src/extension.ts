import * as vscode from "vscode";
import { configureAiProvider, createAiStatusBarItem, refreshAiStatusBarItem } from "./ai-config.js";
import { AnalyticsPanel } from "./analytics-panel.js";
import { apiFetch } from "./api-client.js";
import { DevicesPanel } from "./devices-panel.js";
import { editDirections, newDirection, reloadDirectionsOnSave } from "./direction-files.js";
import { DirectionsPanel } from "./directions-panel.js";
import { JournalPanel } from "./journal-panel.js";
import { LearningsPanel } from "./learnings-panel.js";
import { ModelTracePanel } from "./model-trace-panel.js";
import { NavProvider } from "./nav-provider.js";
import { configureNotificationQuietPeriod } from "./notifications-config.js";
import { QueueDetailPanel } from "./queue-detail-panel.js";
import { QueuePanel } from "./queue-panel.js";
import { ServerController } from "./server-control.js";
import { SettingsPanel } from "./settings-panel.js";
import { SignalDetailPanel } from "./signal-detail-panel.js";
import { SignalsPanel } from "./signals-panel.js";
import { createStatusIndicatorItem } from "./status-indicator.js";
import { SystemEventsPanel } from "./system-events-panel.js";

/**
 * The sidebar is one short list of section links (NavProvider) — mirroring
 * the mockup's single top nav bar — not a set of trees each dumping live
 * data into view at rest. Every section (Queue, Signals, Directions,
 * Learnings, Analytics, Journal, Devices) opens as its own webview panel
 * only once clicked, which is where all the detail the mockup shows lives.
 * This keeps the sidebar itself calm: a goal of this tool, not an
 * incidental side effect of how VS Code happens to lay out tree views.
 */
export function activate(context: vscode.ExtensionContext): void {
  const navTreeView = vscode.window.createTreeView("mind.nav", {
    treeDataProvider: new NavProvider(),
  });
  context.subscriptions.push(navTreeView);

  // Status indicator: blue+spinning while any apiFetch call is in flight,
  // green briefly on success, red on failure, yellow for a flagged warning.
  // Status bar only — a badge on the nav tree would be a count sitting next
  // to the icon whether or not anyone asked for it.
  const statusItem = createStatusIndicatorItem();
  context.subscriptions.push(statusItem);

  // Server lifecycle: start / stop / restart icons in the sidebar title bar.
  const server = new ServerController();
  context.subscriptions.push(
    server,
    vscode.commands.registerCommand("mind.server.start", () => server.start()),
    vscode.commands.registerCommand("mind.server.stop", () => server.stop()),
    vscode.commands.registerCommand("mind.server.restart", () => server.restart()),
  );
  server.watch();

  // ── Section panels ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.queue", () => QueuePanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.queue.item", (itemId: string) =>
      QueueDetailPanel.show(itemId),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.signals", () => SignalsPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.signal.open", (signalId: string) =>
      SignalDetailPanel.show(signalId),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.directions", () => DirectionsPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.learnings", () => LearningsPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.analytics", () => AnalyticsPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.journal", () => JournalPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.systemEvents", () => SystemEventsPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.modelTrace", () => ModelTracePanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.devices", () => DevicesPanel.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.settings", () => SettingsPanel.show()),
  );

  // ── Other commands ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.capture", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Thought title",
        placeHolder: "What needs your attention?",
      });
      if (!title) return;

      const body = await vscode.window.showInputBox({
        prompt: "Body (optional)",
        placeHolder: "Any context…",
      });

      try {
        await apiFetch("/thoughts", {
          method: "POST",
          body: JSON.stringify({ title, body: body ?? "", directionId: null }),
        });
        vscode.window.showInformationMessage("mind: thought captured.");
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),
  );

  // Pause all sends via the server
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.pause", async () => {
      try {
        await apiFetch("/admin/pause", { method: "POST" });
        vscode.window.showInformationMessage(
          "mind: sends paused. Use 'mind: Resume Sends' to re-enable.",
        );
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),
  );

  // Resume sends via the server
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.resume", async () => {
      try {
        await apiFetch("/admin/resume", { method: "POST" });
        vscode.window.showInformationMessage("mind: sends resumed.");
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),
  );

  // Switch AI provider/model without restarting the server
  const aiStatusBarItem = createAiStatusBarItem();
  context.subscriptions.push(aiStatusBarItem);
  refreshAiStatusBarItem(aiStatusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.ai.configure", async () => {
      await configureAiProvider();
      await refreshAiStatusBarItem(aiStatusBarItem);
    }),
  );

  // Edit a direction yaml file via QuickPick — new Directions are still
  // authored as YAML (source of truth); the Directions panel edits an
  // existing one's live-safe fields.
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.direction.edit", async () => {
      try {
        await editDirections();
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),
    vscode.commands.registerCommand("mind.direction.new", async () => {
      try {
        await newDirection();
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),
  );
  reloadDirectionsOnSave(context);

  // Notification quiet period — when mind may proactively notify, separate
  // from asking for something right now and from the send gates.
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.notifications.configure", async () => {
      await configureNotificationQuietPeriod();
    }),
  );
}

export function deactivate(): void {
  /* nothing to clean up — server is a separate process */
}
