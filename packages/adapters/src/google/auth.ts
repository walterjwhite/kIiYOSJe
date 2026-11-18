/**
 * Google OAuth for Gmail and Calendar.
 *
 * One OAuth client can hold refresh tokens for several accounts. Credentials
 * come from ~/.config/kIiYOSJe/mind/credentials.yml (`google:` section) or
 * MIND_GOOGLE_* environment variables. The flat section is the `default`
 * account; `google.accounts` adds more:
 *
 *   google:
 *     clientId: "..."
 *     clientSecret: "..."
 *     refreshToken: "..."      # default
 *     accounts:
 *       - label: work
 *         address: me@work.example
 *         refreshToken: "..."
 *
 * The access-token cache is keyed by the refresh token, not one module-level
 * slot: a second account must never be handed the first account's token.
 */

import {
  accountCredential,
  credentialAccounts,
  credentialString,
} from "@mind/core";
import type { CredentialAccount } from "@mind/core";
import { AdapterNotConfiguredError } from "../errors.js";
import { requestJson } from "@mind/core";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
];

const cachedTokens = new Map<string, { value: string; expiresAt: number }>();

/** The configured account, or a default placeholder so env-only setups work. */
function googleAccount(label = "default"): CredentialAccount | undefined {
  const configured = credentialAccounts("google").find(
    (account) => account.label === label,
  );
  if (configured) return configured;
  return label === "default"
    ? { label: "default", section: "google", config: {} }
    : undefined;
}

/** Labels of every Google account with a refresh token configured. */
export function googleAccountLabels(): string[] {
  const labels = credentialAccounts("google")
    .filter(
      (account) =>
        accountCredential(
          account,
          "refreshToken",
          "MIND_GOOGLE_REFRESH_TOKEN",
        ) !== undefined,
    )
    .map((account) => account.label);
  if (labels.length > 0) return labels;
  return credentialString("google", "refreshToken", "MIND_GOOGLE_REFRESH_TOKEN")
    ? ["default"]
    : [];
}

export function googleCredentials(
  label = "default",
): GoogleCredentials | undefined {
  const account = googleAccount(label);
  if (!account) return undefined;

  const clientId =
    accountCredential(account, "clientId", "MIND_GOOGLE_CLIENT_ID") ??
    (account.label === "default"
      ? credentialString("google", "clientId", "MIND_GOOGLE_CLIENT_ID")
      : undefined);
  const clientSecret =
    accountCredential(account, "clientSecret", "MIND_GOOGLE_CLIENT_SECRET") ??
    (account.label === "default"
      ? credentialString("google", "clientSecret", "MIND_GOOGLE_CLIENT_SECRET")
      : undefined);
  const refreshToken =
    accountCredential(
      account,
      "refreshToken",
      "MIND_GOOGLE_REFRESH_TOKEN",
    ) ??
    (account.label === "default"
      ? credentialString("google", "refreshToken", "MIND_GOOGLE_REFRESH_TOKEN")
      : undefined);

  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

/** Returns a bearer token, throwing AdapterNotConfiguredError when unconfigured. */
export async function googleAccessToken(
  credentials = googleCredentials(),
): Promise<string> {
  if (!credentials) {
    throw new AdapterNotConfiguredError(
      "google",
      "clientId/clientSecret/refreshToken",
    );
  }

  const cacheKey = `${credentials.clientId}:${credentials.refreshToken}`;
  const cached = cachedTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const response = await requestJson<{
    access_token: string;
    expires_in: number;
  }>("https://oauth2.googleapis.com/token", {
    form: {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    },
  });

  cachedTokens.set(cacheKey, {
    value: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  });
  return response.access_token;
}

/** A token for one labelled account (`default`, `work`, …). */
export function googleAccessTokenFor(label = "default"): Promise<string> {
  return googleAccessToken(googleCredentials(label));
}

export function googleScopes(): string[] {
  return [...SCOPES];
}

export function resetGoogleTokenCache(): void {
  cachedTokens.clear();
}
