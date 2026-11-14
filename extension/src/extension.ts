import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { ThoughtsProvider } from "./thoughts-provider.js";
import { ReviewProvider } from "./review-provider.js";
import { BriefPanel } from "./brief-panel.js";
import { apiFetch } from "./api-client.js";

export function activate(context: vscode.ExtensionContext): void {
  const thoughtsProvider = new ThoughtsProvider();
  const reviewProvider = new ReviewProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("mind.thoughts", thoughtsProvider),
    vscode.window.registerTreeDataProvider("mind.review", reviewProvider),
  );

  // ── Commands ───────────────────────────────────────────────────────────────

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

      await apiFetch("/thoughts", {
        method: "POST",
        body: JSON.stringify({ title, body: body ?? "", directionId: null }),
      });

      thoughtsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.pause", async () => {
      vscode.window.showInformationMessage(
        "To pause all sends: restart the server without MIND_SEND_ENABLED=true. " +
          "Proposed actions remain in the Review panel for manual discard.",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.brief", () => {
      BriefPanel.show(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.direction.edit", async () => {
      const dirPath = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        "directions",
      );
      const uri = vscode.Uri.file(dirPath);
      await vscode.commands.executeCommand("revealInExplorer", uri);
    }),
  );

  // Approve action from Review tree
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mind.action.send",
      async (item: vscode.TreeItem & { actionId?: string }) => {
        const id = item.actionId;
        if (!id) return;
        await apiFetch(`/actions/${id}/send`, { method: "POST" });
        reviewProvider.refresh();
      },
    ),
  );

  // Discard action from Review tree
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mind.action.discard",
      async (item: vscode.TreeItem & { actionId?: string }) => {
        const id = item.actionId;
        if (!id) return;
        await apiFetch(`/actions/${id}/discard`, { method: "POST" });
        reviewProvider.refresh();
      },
    ),
  );
}

export function deactivate(): void {
  /* nothing to clean up — server is a separate process */
}
