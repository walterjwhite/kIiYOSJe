/**
 * Microsoft Graph OAuth for Outlook mail.
 *
 * Two supported flows, picked by what the credentials file contains:
 *   refresh_token        delegated access to the mailbox of `user` (default /me)
 *   client_credentials   application access to `user`'s mailbox
 */

import { credentialString } from "@mind/core";
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

let cachedToken: { value: string; expiresAt: number } | undefined;

export function outlookCredentials(): OutlookCredentials | undefined {
  const tenantId = credentialString(
    "outlook",
    "tenantId",
    "MIND_OUTLOOK_TENANT_ID",
  );
  const clientId = credentialString(
    "outlook",
    "clientId",
    "MIND_OUTLOOK_CLIENT_ID",
  );
  const clientSecret = credentialString(
    "outlook",
    "clientSecret",
    "MIND_OUTLOOK_CLIENT_SECRET",
  );
  if (!tenantId || !clientId || !clientSecret) return undefined;

  const refreshToken = credentialString(
    "outlook",
    "refreshToken",
    "MIND_OUTLOOK_REFRESH_TOKEN",
  );
  const user = credentialString("outlook", "user", "MIND_OUTLOOK_USER");
  return {
    tenantId,
    clientId,
    clientSecret,
    ...(refreshToken ? { refreshToken } : {}),
    ...(user ? { user } : {}),
  };
}

export async function outlookToken(
  credentials = outlookCredentials(),
): Promise<string> {
  if (!credentials) {
    throw new AdapterNotConfiguredError(
      "outlook",
      "tenantId/clientId/clientSecret",
    );
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.value;

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

  cachedToken = {
    value: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
  return cachedToken.value;
}

export function resetOutlookTokenCache(): void {
  cachedToken = undefined;
}
