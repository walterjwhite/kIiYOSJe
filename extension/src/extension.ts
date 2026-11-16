import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { ThoughtsProvider, Thought } from "./thoughts-provider.js";
import { ReviewProvider } from "./review-provider.js";
import { BriefPanel } from "./brief-panel.js";
import { apiFetch } from "./api-client.js";
import { configureAiProvider, refreshAiStatusBarItem, createAiStatusBarItem } from "./ai-config.js";

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

  // Open thought body as a temporary markdown file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mind.thought.open",
      async (thought: Thought) => {
        const tmpFile = path.join(
          os.tmpdir(),
          `mind-thought-${thought.id}.md`,
        );
        const content = [
          `# ${thought.title}`,
          "",
          thought.body,
          "",
          "---",
          `**State:** ${thought.state}`,
          `**Next action:** ${thought.nextAction ?? "—"}`,
          "",
        ].join("\n");

        fs.writeFileSync(tmpFile, content, "utf8");

        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(tmpFile),
        );
        await vscode.window.showTextDocument(doc, { preview: true });
      },
    ),
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

  context.subscriptions.push(
    vscode.commands.registerCommand("mind.brief", () => {
      BriefPanel.show(context);
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

  // Edit a direction yaml file via QuickPick
  context.subscriptions.push(
    vscode.commands.registerCommand("mind.direction.edit", async () => {
      const yamlFiles = await vscode.workspace.findFiles(
        "directions/**/*.yaml",
        null,
        50,
      );

      if (yamlFiles.length === 0) {
        vscode.window.showInformationMessage(
          "No direction yaml files found under directions/.",
        );
        const dirPath = path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
          "directions",
        );
        await vscode.commands.executeCommand(
          "revealInExplorer",
          vscode.Uri.file(dirPath),
        );
        return;
      }

      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

      const items = yamlFiles.map((uri) => ({
        label: path.relative(workspaceRoot, uri.fsPath),
        uri,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a direction file to edit",
      });

      if (!picked) return;

      const doc = await vscode.workspace.openTextDocument(picked.uri);
      await vscode.window.showTextDocument(doc);
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
        thoughtsProvider.refresh();
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
        thoughtsProvider.refresh();
      },
    ),
  );
}

export function deactivate(): void {
  /* nothing to clean up — server is a separate process */
}
