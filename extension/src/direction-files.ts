import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { apiFetch } from "./api-client.js";

/**
 * Direction YAML lives where the mind server reads it (MIND_DIRECTIONS_DIR,
 * default <repo>/directions), which is not necessarily a folder VS Code has
 * open. Ask the server instead of searching the workspace.
 */
export async function directionsDir(): Promise<string> {
  const { dir } = await apiFetch<{ dir: string; exists: boolean }>("/directions/source");
  return dir;
}

function collectYaml(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectYaml(full));
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const TEMPLATE = (name: string) => `name: ${name}
scope:
  kind: topic        # person | project | topic | thread
  value: "keyword"   # sender address, thread id, or text found in the signal
posture: absorb      # absorb | draft | surface | escalate
autonomy: observe    # observe | draft | send
confidenceMin: 0.7
standard: |
  Describe how to recognize and respond to this kind of signal.
`;

/** Creates directions/<id>.yaml from a template and opens it. */
export async function newDirection(): Promise<void> {
  const dir = await directionsDir();
  const id = await vscode.window.showInputBox({
    prompt: "New direction id (becomes directions/<id>.yaml, e.g. work/invoices)",
    validateInput: (v) =>
      /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(v) && !v.split("/").includes("..")
        ? undefined
        : "Use letters, digits, . _ - and / only",
  });
  if (!id) return;

  const file = path.join(dir, `${id}.yaml`);
  if (fs.existsSync(file)) {
    vscode.window.showErrorMessage(`mind: ${id} already exists.`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, TEMPLATE(path.basename(id)), { flag: "wx" });
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
}

/** Picks a direction YAML file to edit, or creates a new one. */
export async function editDirections(): Promise<void> {
  const dir = await directionsDir();
  const files = collectYaml(dir);

  const NEW = "$(add) New direction…";
  const items: vscode.QuickPickItem[] = [
    { label: NEW, description: dir },
    ...files.map((f) => ({ label: path.relative(dir, f), description: f })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder:
      files.length === 0 ? `No direction files in ${dir}` : "Select a direction file to edit",
  });
  if (!picked) return;
  if (picked.label === NEW) return newDirection();

  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(picked.description!),
  );
}

/** Saving a direction YAML file under the server's directory reloads it. */
export function reloadDirectionsOnSave(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!/\.ya?ml$/.test(doc.fileName)) return;
      try {
        const dir = await directionsDir();
        if (path.relative(dir, doc.fileName).startsWith("..")) return;
        await apiFetch("/directions/reload", { method: "POST" });
        vscode.window.setStatusBarMessage("mind: directions reloaded", 3000);
      } catch (err) {
        vscode.window.showErrorMessage(`mind: could not reload directions: ${String(err)}`);
      }
    }),
  );
}
