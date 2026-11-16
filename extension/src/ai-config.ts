/**
 * AI provider configuration command.
 *
 * Lets the operator switch between ollama (local, free) and the cloud
 * providers without restarting the server — PUT /admin/ai-config writes
 * ~/.config/mind/ai.json, which classify()/draft() read fresh on every call.
 */

import * as vscode from "vscode";
import { apiFetch } from "./api-client.js";

interface AiConfigResponse {
  provider: "ollama" | "openai" | "anthropic" | "google";
  classifyModel: string;
  draftModel: string;
  baseURL: string;
  apiKeyConfigured: boolean;
}

const PROVIDER_CHOICES: Array<{
  label: string;
  description: string;
  provider: AiConfigResponse["provider"];
  needsKey: boolean;
  defaultModel: string;
}> = [
  {
    label: "Ollama (local)",
    description: "Free, runs on this machine, no data leaves the device",
    provider: "ollama",
    needsKey: false,
    defaultModel: "qwen2.5:3b-instruct",
  },
  {
    label: "OpenAI",
    description: "Cloud — requires an API key",
    provider: "openai",
    needsKey: true,
    defaultModel: "gpt-4o-mini",
  },
  {
    label: "Anthropic",
    description: "Cloud — requires an API key",
    provider: "anthropic",
    needsKey: true,
    defaultModel: "claude-haiku-4-5",
  },
  {
    label: "Google",
    description: "Cloud — requires an API key",
    provider: "google",
    needsKey: true,
    defaultModel: "gemini-2.0-flash",
  },
];

export async function configureAiProvider(): Promise<void> {
  let current: AiConfigResponse | undefined;
  try {
    current = await apiFetch<AiConfigResponse>("/admin/ai-config");
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
    return;
  }

  const picked = await vscode.window.showQuickPick(
    PROVIDER_CHOICES.map((p) => ({
      ...p,
      picked: p.provider === current?.provider,
    })),
    {
      placeHolder: `Current: ${current.provider} (${current.classifyModel})`,
      title: "mind: Select AI Provider",
    },
  );
  if (!picked) return;

  const classifyModel = await vscode.window.showInputBox({
    title: "Classifier model (fast/cheap calls)",
    value:
      picked.provider === current.provider
        ? current.classifyModel
        : picked.defaultModel,
  });
  if (classifyModel === undefined) return;

  const draftModel = await vscode.window.showInputBox({
    title: "Draft model (reply generation)",
    value:
      picked.provider === current.provider
        ? current.draftModel
        : picked.defaultModel,
  });
  if (draftModel === undefined) return;

  let baseURL: string | undefined;
  if (picked.provider === "ollama") {
    baseURL = await vscode.window.showInputBox({
      title: "Ollama base URL",
      value:
        picked.provider === current.provider
          ? current.baseURL
          : "http://localhost:11434/v1",
    });
    if (baseURL === undefined) return;
  }

  let apiKey: string | undefined;
  if (picked.needsKey) {
    apiKey = await vscode.window.showInputBox({
      title: `${picked.label} API key`,
      password: true,
      placeHolder: current.apiKeyConfigured
        ? "Leave blank to keep the existing key"
        : "Required — no key is currently configured",
    });
    if (apiKey === undefined) return;
  }

  try {
    await apiFetch("/admin/ai-config", {
      method: "PUT",
      body: JSON.stringify({
        provider: picked.provider,
        classifyModel,
        draftModel,
        ...(baseURL ? { baseURL } : {}),
        ...(apiKey ? { apiKey } : {}),
      }),
    });
    vscode.window.showInformationMessage(
      `mind: AI provider set to ${picked.label} (${classifyModel}). Takes effect on the next signal — no restart needed.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
  }
}

/**
 * Status bar item showing the active provider, e.g. "$(circuit-board) ollama".
 * Clicking it opens the same picker as the command palette entry.
 */
export function createAiStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90,
  );
  item.command = "mind.ai.configure";
  item.tooltip = "mind: click to change AI provider / model";
  item.show();
  return item;
}

export async function refreshAiStatusBarItem(
  item: vscode.StatusBarItem,
): Promise<void> {
  try {
    const current = await apiFetch<AiConfigResponse>("/admin/ai-config");
    const icon = current.provider === "ollama" ? "$(device-desktop)" : "$(cloud)";
    item.text = `${icon} ${current.provider}`;
  } catch {
    item.text = "$(warning) mind: offline";
  }
}
