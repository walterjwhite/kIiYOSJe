/**
 * Adapter credentials: environment first, then ~/.config/kIiYOSJe/mind/credentials.yml.
 *
 * A missing file yields an empty object so every adapter degrades to
 * "not configured" instead of failing startup. The file is re-read when its
 * mtime changes, so rotating a token needs no restart.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configDir } from "./config.js";

export type CredentialSection = Record<string, unknown>;
export type Credentials = Record<string, CredentialSection>;

let cached: { at: number; value: Credentials } | undefined;

export function credentialsPath(): string {
  return `${configDir()}/credentials.yml`;
}

export function loadCredentials(): Credentials {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  const mtime = statSync(path).mtimeMs;
  if (cached?.at === mtime) return cached.value;

  const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
  const value =
    parsed && typeof parsed === "object" ? (parsed as Credentials) : {};
  cached = { at: mtime, value };
  return value;
}

/** Environment first, then the named section of credentials.yml. */
export function credentialString(
  section: string,
  key: string,
  envVar: string,
): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  const value = loadCredentials()[section]?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Resets the credential cache — tests replace the file between cases. */
export function resetCredentialCache(): void {
  cached = undefined;
}

/** Addresses that count as "me" when deciding if a signal is addressed directly. */
export function operatorAddresses(): string[] {
  const raw = loadCredentials()["operator"];
  const configured = raw?.["addresses"];
  if (Array.isArray(configured)) {
    return configured.filter(
      (value): value is string => typeof value === "string",
    );
  }
  return [];
}
