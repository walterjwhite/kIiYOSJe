/**
 * Google OAuth for Gmail and Calendar.
 *
 * One refresh token authorises both APIs; the access token is cached in memory
 * until shortly before it expires. Credentials come from ~/.config/walterjwhite/mind/
 * credentials.yml (`google:` section) or MIND_GOOGLE_* environment variables.
 */

import { credentialString } from "@mind/core";
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

let cachedToken: { value: string; expiresAt: number } | undefined;

export function googleCredentials(): GoogleCredentials | undefined {
  const clientId = credentialString(
    "google",
    "clientId",
    "MIND_GOOGLE_CLIENT_ID",
  );
  const clientSecret = credentialString(
    "google",
    "clientSecret",
    "MIND_GOOGLE_CLIENT_SECRET",
  );
  const refreshToken = credentialString(
    "google",
    "refreshToken",
    "MIND_GOOGLE_REFRESH_TOKEN",
  );
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
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.value;

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

  cachedToken = {
    value: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
  return cachedToken.value;
}

export function googleScopes(): string[] {
  return [...SCOPES];
}

export function resetGoogleTokenCache(): void {
  cachedToken = undefined;
}
