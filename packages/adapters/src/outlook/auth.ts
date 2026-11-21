/**
 * Microsoft Graph OAuth for Outlook mail.
 *
 * Two supported flows, picked by what the account's credentials contain:
 *   refresh_token        delegated access to the mailbox of `user` (default /me)
 *   client_credentials   application access to `user`'s mailbox
 *
 * Several accounts can share one app registration:
 *
 *   outlook:
 *     tenantId: "..."
 *     clientId: "..."
 *     clientSecret: "..."
 *     accounts:
 *       - label: work
 *         address: me@work.example
 *         refreshToken: "..."
 *       - label: shared
 *         user: team@work.example    # client_credentials
 *
 * The token cache is keyed per account, so two mailboxes never share a token.
 */

import { accountCredential, credentialAccounts, credentialString } from "@mind/core";
import type { CredentialAccount } from "@mind/core";
import { requestJson } from "@mind/core";
import { AdapterNotConfiguredError } from "../errors.js";

export interface OutlookCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  user?: string;
}

const GRAPH = "https://graph.microsoft.com";

const cachedTokens = new Map<string, { value: string; expiresAt: number }>();

function outlookAccount(label = "default"): CredentialAccount | undefined {
  const configured = credentialAccounts("outlook").find((account) => account.label === label);
  if (configured) return configured;
  return label === "default" ? { label: "default", section: "outlook", config: {} } : undefined;
}

/** Labels of every Outlook account with enough credentials to poll. */
export function outlookAccountLabels(): string[] {
  const labels = credentialAccounts("outlook")
    .filter(
      (account) =>
        accountCredential(account, "tenantId", "MIND_OUTLOOK_TENANT_ID") &&
        accountCredential(account, "clientId", "MIND_OUTLOOK_CLIENT_ID") &&
        accountCredential(account, "clientSecret", "MIND_OUTLOOK_CLIENT_SECRET"),
    )
    .map((account) => account.label);
  if (labels.length > 0) return labels;
  return outlookCredentials("default") ? ["default"] : [];
}

export function outlookCredentials(label = "default"): OutlookCredentials | undefined {
  const account = outlookAccount(label);
  if (!account) return undefined;

  const tenantId = accountCredential(account, "tenantId", "MIND_OUTLOOK_TENANT_ID");
  const clientId = accountCredential(account, "clientId", "MIND_OUTLOOK_CLIENT_ID");
  const clientSecret = accountCredential(account, "clientSecret", "MIND_OUTLOOK_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) return undefined;

  const refreshToken = accountCredential(account, "refreshToken", "MIND_OUTLOOK_REFRESH_TOKEN");
  const user = accountCredential(account, "user", "MIND_OUTLOOK_USER");
  return {
    tenantId,
    clientId,
    clientSecret,
    ...(refreshToken ? { refreshToken } : {}),
    ...(user ? { user } : {}),
  };
}

export async function outlookToken(credentials = outlookCredentials()): Promise<string> {
  if (!credentials) {
    throw new AdapterNotConfiguredError("outlook", "tenantId/clientId/clientSecret");
  }

  const cacheKey = [
    credentials.tenantId,
    credentials.clientId,
    credentials.refreshToken ?? `client:${credentials.user ?? "me"}`,
  ].join(":");
  const cached = cachedTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const form: Record<string, string> = credentials.refreshToken
    ? {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
        scope: `${GRAPH}/Mail.ReadWrite ${GRAPH}/Mail.Send offline_access`,
      }
    : {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "client_credentials",
        scope: `${GRAPH}/.default`,
      };

  const response = await requestJson<{
    access_token: string;
    expires_in: number;
  }>(
    `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
    { form },
  );

  cachedTokens.set(cacheKey, {
    value: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  });
  return response.access_token;
}

/** A token for one labelled account (`default`, `work`, …). */
export function outlookTokenFor(label = "default"): Promise<string> {
  return outlookToken(outlookCredentials(label));
}

export function resetOutlookTokenCache(): void {
  cachedTokens.clear();
}

/** Legacy single-account helper used by doctor/diagnostics. */
export function outlookConfigured(): boolean {
  return Boolean(
    credentialString("outlook", "tenantId", "MIND_OUTLOOK_TENANT_ID") &&
      credentialString("outlook", "clientId", "MIND_OUTLOOK_CLIENT_ID") &&
      credentialString("outlook", "clientSecret", "MIND_OUTLOOK_CLIENT_SECRET"),
  );
}
