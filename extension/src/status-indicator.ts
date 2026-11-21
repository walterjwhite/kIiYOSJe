import * as vscode from "vscode";

/**
 * A single status-bar indicator for background server activity — VS Code
 * has no API to recolor or animate the Activity Bar container icon itself,
 * so this uses the status bar instead, which does support both a spin
 * animation (`$(loading~spin)`, the standard VS Code idiom for "working")
 * and background/foreground theme colors. Every `apiFetch` call drives it
 * automatically, so no panel has to manage this itself:
 *
 *   refreshing — blue, spinning
 *   success    — green, settles back to idle after a couple of seconds
 *   error      — red, stays until the next request
 *   warning    — yellow, for a call that succeeded but wants to flag something
 *
 * The nav tree view's own badge mirrors the same state as a second, always-
 * visible cue next to the mind icon in the Activity Bar.
 */
export type IndicatorState = "idle" | "refreshing" | "success" | "error" | "warning";

const COLORS: Record<IndicatorState, vscode.ThemeColor | undefined> = {
  idle: undefined,
  refreshing: new vscode.ThemeColor("charts.blue"),
  success: new vscode.ThemeColor("charts.green"),
  error: new vscode.ThemeColor("charts.red"),
  warning: new vscode.ThemeColor("charts.yellow"),
};

const ICONS: Record<IndicatorState, string> = {
  idle: "circle-outline",
  refreshing: "loading~spin",
  success: "pass-filled",
  error: "error",
  warning: "warning",
};

const LABELS: Record<IndicatorState, string> = {
  idle: "mind: idle",
  refreshing: "mind: refreshing…",
  success: "mind: up to date",
  error: "mind: request failed",
  warning: "mind: warning",
};

const SETTLE_MS = 2500;

class StatusIndicator {
  private item: vscode.StatusBarItem | undefined;
  private badgeTargets: vscode.TreeView<unknown>[] = [];
  private settleTimer: NodeJS.Timeout | undefined;
  private inFlight = 0;

  attach(item: vscode.StatusBarItem): void {
    this.item = item;
    this.set("idle");
  }

  /** Mirror the same state onto one or more tree views' badges. */
  mirrorBadge(...views: vscode.TreeView<unknown>[]): void {
    this.badgeTargets.push(...views);
  }

  /** Call at the start of a request; pair with end(). Tracks overlapping calls. */
  begin(): void {
    this.inFlight++;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.set("refreshing");
  }

  /** Call when a request settles. ok=false shows the error state. */
  end(ok: boolean): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight > 0) return; // other requests still in flight

    if (!ok) {
      this.set("error");
      return;
    }
    this.set("success");
    this.settleTimer = setTimeout(() => this.set("idle"), SETTLE_MS);
  }

  /** For a result that succeeded but deserves a yellow flag (e.g. a partial undo). */
  warn(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.set("warning");
    this.settleTimer = setTimeout(() => this.set("idle"), SETTLE_MS);
  }

  private set(state: IndicatorState): void {
    if (this.item) {
      this.item.text = `$(${ICONS[state]}) mind`;
      this.item.color = COLORS[state];
      this.item.tooltip = LABELS[state];
    }
    for (const view of this.badgeTargets) {
      view.badge =
        state === "error" || state === "warning" ? { value: 1, tooltip: LABELS[state] } : undefined;
    }
  }
}

export const statusIndicator = new StatusIndicator();

export function createStatusIndicatorItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.show();
  statusIndicator.attach(item);
  return item;
}
