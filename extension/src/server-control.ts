import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { serverUrl, readToken } from "./api-client.js";

/**
 * Start / stop / restart the mind server from the extension.
 *
 * Start runs `node packages/server/dist/main.js` from the repo root as a child
 * process whose output goes to the "mind server" output channel. It does not
 * build anything: if dist/main.js is missing, say so and stop.
 *
 * Stop works whether or not this extension started the server. A server it
 * spawned is sent SIGTERM; any other (for example one running in a terminal)
 * is asked to exit through POST /admin/shutdown.
 *
 * A server started here is stopped when the extension deactivates, so closing
 * VS Code does not leave a background process behind.
 */

const POLL_MS = 5000;
const START_TIMEOUT_MS = 20000;
const STOP_TIMEOUT_MS = 10000;
const MAIN_JS = path.join("packages", "server", "dist", "main.js");

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True if anything answers HTTP at the server URL. A 401 still means "up". */
async function isUp(): Promise<boolean> {
  try {
    await fetch(`${serverUrl()}/health`, {
      headers: { Authorization: `Bearer ${readToken() ?? ""}` },
      signal: AbortSignal.timeout(1500),
    });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(up: boolean, timeoutMs: number, abort?: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isUp()) === up) return true;
    if (abort?.()) return false;
    await sleep(300);
  }
  return false;
}

function findRoot(): string | undefined {
  const configured = vscode.workspace.getConfiguration("mind").get<string>("serverRoot");
  const candidates = configured
    ? [configured]
    : (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  return candidates.find((dir) => fs.existsSync(path.join(dir, MAIN_JS)));
}

export class ServerController implements vscode.Disposable {
  private readonly log = vscode.window.createOutputChannel("mind server");
  private child: ChildProcess | undefined;
  private busy = false;
  private timer: NodeJS.Timeout | undefined;

  /** Begin polling so the toolbar shows start or stop/restart to match reality. */
  watch(): void {
    void this.refreshContext();
    this.timer = setInterval(() => void this.refreshContext(), POLL_MS);
  }

  private async refreshContext(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "mind.serverRunning", await isUp());
  }

  async start(): Promise<void> {
    await this.exclusive("start", async () => {
      if (await isUp()) {
        vscode.window.showInformationMessage("mind: server is already running.");
        return;
      }
      await this.spawnAndWait();
    });
  }

  async stop(): Promise<void> {
    await this.exclusive("stop", async () => {
      if (!(await isUp())) {
        vscode.window.showInformationMessage("mind: server is not running.");
        return;
      }
      await this.stopRunning();
      vscode.window.showInformationMessage("mind: server stopped.");
    });
  }

  async restart(): Promise<void> {
    await this.exclusive("restart", async () => {
      if (await isUp()) await this.stopRunning();
      await this.spawnAndWait();
    });
  }

  private async exclusive(label: string, work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      vscode.window.showWarningMessage("mind: another server operation is in progress.");
      return;
    }
    this.busy = true;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `mind: ${label} server…` },
        work,
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `mind: could not ${label} server: ${String(err instanceof Error ? err.message : err)}`,
      );
    } finally {
      this.busy = false;
      await this.refreshContext();
    }
  }

  private async spawnAndWait(): Promise<void> {
    const root = findRoot();
    if (!root) {
      throw new Error(
        `${MAIN_JS} not found. Build the server (sh scripts/build-server.sh) and open the repo as a workspace, or set "mind.serverRoot".`,
      );
    }
    const cfg = vscode.workspace.getConfiguration("mind");
    const node = cfg.get<string>("nodePath") || "node";
    const extraEnv = cfg.get<Record<string, string>>("serverEnv") ?? {};

    this.log.appendLine(`$ ${node} ${MAIN_JS}   (cwd ${root})`);
    const child = spawn(node, [MAIN_JS], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    let exited: string | undefined;
    child.stdout?.on("data", (d: Buffer) => this.log.append(d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.log.append(d.toString()));
    child.on("error", (err) => {
      exited = `failed to launch "${node}": ${err.message}`;
    });
    child.on("exit", (code, signal) => {
      exited = `exited with ${signal ?? `code ${code}`}`;
      if (this.child === child) this.child = undefined;
      this.log.appendLine(`[server ${exited}]`);
    });

    const up = await waitFor(true, START_TIMEOUT_MS, () => exited !== undefined);
    if (!up) {
      this.log.show(true);
      if (this.child === child) child.kill("SIGTERM");
      throw new Error(
        exited ?? `no response within ${START_TIMEOUT_MS / 1000}s. See the "mind server" output.`,
      );
    }
    vscode.window.showInformationMessage("mind: server started.");
  }

  private async stopRunning(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    } else {
      const res = await fetch(`${serverUrl()}/admin/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${readToken() ?? ""}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`shutdown request failed: HTTP ${res.status}`);
    }
    if (!(await waitFor(false, STOP_TIMEOUT_MS))) {
      if (child && child.exitCode === null) child.kill("SIGKILL");
      if (!(await waitFor(false, 2000))) throw new Error("server did not stop in time.");
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM");
    this.log.dispose();
  }
}
