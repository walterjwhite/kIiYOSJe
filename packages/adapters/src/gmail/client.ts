/**
 * Gmail REST client — read (list + get) and write (send). The access token is
 * supplied by a resolver so the client can be exercised with a fixed token in
 * tests and with the OAuth flow at runtime.
 */

import { requestJson } from "@mind/core";
import type { OutboundDraft, SendResult } from "@mind/core";
import { buildRawMessage, type GmailMessage } from "./mapper.js";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1";

export type TokenResolver = () => Promise<string>;

export class GmailClient {
  constructor(
    private readonly token: TokenResolver,
    private readonly baseUrl = BASE_URL,
    private readonly selfAddress = "",
  ) {}

  async listMessageIds(query: string, maxResults = 25): Promise<string[]> {
    const response = await requestJson<{ messages?: { id: string }[] }>(
      `${this.baseUrl}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: await this.authHeaders() },
    );
    return (response.messages ?? []).map((message) => message.id);
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return requestJson<GmailMessage>(
      `${this.baseUrl}/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { headers: await this.authHeaders() },
    );
  }

  async send(draft: OutboundDraft): Promise<SendResult> {
    const response = await requestJson<{ id: string }>(
      `${this.baseUrl}/users/me/messages/send`,
      {
        headers: await this.authHeaders(),
        json: {
          raw: buildRawMessage({
            from: this.selfAddress,
            to: draft.to,
            subject: draft.subject ?? "(no subject)",
            body: draft.body,
            inReplyTo: draft.replyToExternalId,
          }),
          ...(draft.threadId ? { threadId: draft.threadId } : {}),
        },
      },
    );
    return { externalId: response.id };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }
}
