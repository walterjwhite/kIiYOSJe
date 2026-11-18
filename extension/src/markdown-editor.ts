import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Opens a field's content as a real Markdown editor tab — genuine syntax
 * highlighting from the actual editor, not a webview textarea pretending
 * to be one, and no bundled Monaco build to manage. A Direction's guidance
 * and match/response prompts are expected to be Markdown, so the language
 * mode is set accordingly.
 *
 * The tab title is the file name, so this writes a real temp file named
 * `<slug>.md` instead of opening an untitled document — VS Code has no API
 * to set an untitled document's displayed tab title beyond "Untitled-N",
 * but it always shows a real file's name. `slug` should already be the
 * desired title (e.g. "catch-all-standard"); this only sanitizes it into a
 * safe filename.
 *
 * Saves (Ctrl/Cmd+S) call `onSave` with the document's current text. The
 * temp file is deleted once the editor tab closes, saved or not — nothing
 * accumulates in the OS temp directory across edits.
 */
export async function editAsMarkdown(
  slug: string,
  content: string,
  onSave: (newContent: string) => Promise<void>,
): Promise<void> {
  const safeSlug = slug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "field";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mind-edit-"));
  const filePath = path.join(dir, `${safeSlug}.md`);
  fs.writeFileSync(filePath, content, "utf8");

  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });

  vscode.window.setStatusBarMessage(
    `mind: editing ${safeSlug} — save (Ctrl/Cmd+S) to apply, close the tab when done`,
    6000,
  );

  const saveSub = vscode.workspace.onDidSaveTextDocument(async (saved) => {
    if (saved.uri.toString() !== doc.uri.toString()) return;
    await onSave(saved.getText());
  });

  const closeSub = vscode.workspace.onDidCloseTextDocument((closed) => {
    if (closed.uri.toString() !== doc.uri.toString()) return;
    saveSub.dispose();
    closeSub.dispose();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  });
}
