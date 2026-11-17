import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

export type SignalRange = "today" | "7d" | "30d" | "all";

export interface Signal {
  id: string;
  adapter: string;
  externalId: string;
  threadId: string | null;
  sender: string;
  recipients: string; // JSON string[]
  kind: string;
  body: string;
  receivedAt: string;
  urgencyHint: number | null;
  disposition: string;
  thoughtId: string | null;
  directionId: string | null;
  signalKind: string | null;
  escalateBy: string | null;
  dedupeKey: string;
}

const RANGE_LABEL: Record<SignalRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All",
};

/**
 * Tree view over GET /signals, defaulting to today and widened with the
 * "mind: Set Signals Range" command — the real-system equivalent of the
 * mockup's Signals range selector. There is no separate History view here,
 * same reasoning as the mockup: a signal's row already reflects its own
 * current state.
 */
export class SignalsProvider implements vscode.TreeDataProvider<Signal> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    Signal | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private range: SignalRange = "today";

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async setRange(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      (Object.keys(RANGE_LABEL) as SignalRange[]).map((r) => ({
        label: RANGE_LABEL[r],
        range: r,
      })),
      { placeHolder: `Signals range (current: ${RANGE_LABEL[this.range]})` },
    );
    if (!picked) return;
    this.range = picked.range;
    this.refresh();
  }

  getTreeItem(signal: Signal): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `[${signal.adapter}] ${signal.sender}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${signal.disposition}${signal.directionId ? ` · ${signal.directionId}` : ""}`;
    item.tooltip = signal.body.slice(0, 300);
    item.contextValue = "signal";
    (item as vscode.TreeItem & { signalId: string; directionId: string | null }).signalId =
      signal.id;
    (item as vscode.TreeItem & { signalId: string; directionId: string | null }).directionId =
      signal.directionId;
    return item;
  }

  async getChildren(): Promise<Signal[]> {
    try {
      return await apiFetch<Signal[]>(`/signals?range=${this.range}`);
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
      return [];
    }
  }
}

/** "mind: Reclassify Signal" — moves a signal to a different direction when the match itself was wrong. */
export async function reclassifySignal(
  item: vscode.TreeItem & { signalId?: string },
): Promise<void> {
  const signalId = item.signalId;
  if (!signalId) return;

  interface DirectionRow {
    id: string;
    name: string;
  }
  let dirs: DirectionRow[];
  try {
    dirs = await apiFetch<DirectionRow[]>("/directions");
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
  }
}
