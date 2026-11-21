import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";
import { extractLink } from "./link-extract.js";
import type { TimingBucket } from "./format.js";

/** Shapes returned by GET /queue (see packages/server/src/routes/queue.ts). */
export interface ItemAction {
  id: string;
  label: string;
  kind: "approve" | "discard" | "acknowledge" | "openLink";
  linkPrefix?: string;
  confirm?: string;
  linkAvailable?: boolean;
}

export interface QueueItem {
  id: string;
  type: "reply" | "attention";
  actionId: string | null;
  signalId: string;
  thoughtId: string | null;
  adapter: string;
  account: string | null;
  sender: string;
  subject: string | null;
  summary: string;
  draftPreview: string | null;
  receivedAt: string;
  queuedAt: string;
  direction: { id: string; name: string } | null;
  assessment: {
    intent: string | null;
    urgency: string | null;
    signalKind: string | null;
    answerable: boolean | null;
    confidence: number | null;
    reason: string | null;
  } | null;
  timing: { bucket: TimingBucket; actBy: string | null; reason: string };
  actions: ItemAction[];
  position: number | null;
  /** YYYY-MM-DD the operator plans to deal with it; null means backlog. */
  plannedFor: string | null;
}

/** Marks the signal reviewed, closes its thought, dismisses any proposed reply. */
export async function acknowledgeSignal(signalId: string): Promise<void> {
  await apiFetch(`/signals/${signalId}/acknowledge`, { method: "POST" });
}

/**
 * Opens a link from the message in the operator's own browser, where their
 * signed-in session applies. The server never fetches it. The link is
 * extracted strictly against the declared prefix and confirmed first.
 */
export async function openLinkAction(
  action: { label: string; linkPrefix: string; confirm?: string | undefined },
  htmlBody: string | null,
  body: string | null,
): Promise<void> {
  const link = extractLink(htmlBody, body, action.linkPrefix);
  if (!link) {
    vscode.window.showErrorMessage(`mind: no matching link found for "${action.label}".`);
    return;
  }
  const url = new URL(link);
  const choice = await vscode.window.showWarningMessage(
    action.confirm ?? `Open a link on ${url.host} in your browser?`,
    { modal: true, detail: `${url.host}${url.pathname}` },
    "Open",
  );
  if (choice !== "Open") return;
  await vscode.env.openExternal(vscode.Uri.parse(link, true));
}

/**
 * Runs one of an item's actions. Returns true if queue state may have
 * changed (so the caller should reload); errors are shown, not thrown.
 */
export async function runItemAction(
  item: Pick<QueueItem, "actionId" | "signalId">,
  action: ItemAction,
): Promise<boolean> {
  try {
    switch (action.kind) {
      case "approve":
        if (!item.actionId) return false;
        await apiFetch(`/actions/${item.actionId}/send`, { method: "POST" });
        return true;
      case "discard":
        if (!item.actionId) return false;
        await apiFetch(`/actions/${item.actionId}/discard`, { method: "POST" });
        return true;
      case "acknowledge":
        await acknowledgeSignal(item.signalId);
        return true;
      case "openLink": {
        if (!action.linkPrefix) return false;
        const { signal } = await apiFetch<{
          signal: { htmlBody: string | null; body: string };
        }>(`/signals/${item.signalId}/explain`);
        await openLinkAction(
          { label: action.label, linkPrefix: action.linkPrefix, confirm: action.confirm },
          signal.htmlBody,
          signal.body,
        );
        return false;
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
    return true;
  }
}
