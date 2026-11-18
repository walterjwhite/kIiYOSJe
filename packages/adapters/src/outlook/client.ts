/**
 * Microsoft Graph mail client — list unread messages and send a reply.
 *
 * The reply is created as a draft and then sent, so the returned id refers to a
 * real message the operator can find in Sent Items (Graph's sendMail action
 * returns no id).
 */

import { requestJson } from "@mind/core";
import type { OutboundDraft, SendResult } from "@mind/core";
import type { GraphMessage } from "./types.js";

const BASE_URL = "https://graph.microsoft.com/v1.0";
const SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "from",
  "toRecipients",
  "receivedDateTime",
  "body",
  "bodyPreview",
  "isRead",
  "importance",
].join(",");

type TokenResolver = () => Promise<string>;

export class OutlookClient {
  constructor(
    private readonly token: TokenResolver,
    private readonly user?: string,
    private readonly baseUrl = BASE_URL,
  ) {}

  async listUnread(since: Date, limit = 25): Promise<GraphMessage[]> {
    const query = new URLSearchParams({
      $filter: `receivedDateTime ge ${since.toISOString()} and isRead eq false`,
      $select: SELECT,
      $top: String(limit),
      $orderby: "receivedDateTime desc",
    });
    const response = await requestJson<{ value?: GraphMessage[] }>(
      `${this.baseUrl}${this.mailbox()}/messages?${query.toString()}`,
      { headers: await this.authHeaders() },
    );
    return response.value ?? [];
  }

  async send(draft: OutboundDraft): Promise<SendResult> {
    const created = await requestJson<{ id: string }>(
      `${this.baseUrl}${this.mailbox()}/messages`,
      {
        headers: await this.authHeaders(),
        json: {
          subject: draft.subject ?? "(no subject)",
          body: { contentType: "Text", content: draft.body },
          toRecipients: draft.to.map((address) => ({
            emailAddress: { address },
          })),
          ...(draft.threadId ? { conversationId: draft.threadId } : {}),
        },
      },
    );
    await requestJson<void>(
      `${this.baseUrl}${this.mailbox()}/messages/${created.id}/send`,
      {
        headers: await this.authHeaders(),
        method: "POST",
        json: {},
      },
    );
    return { externalId: created.id };
  }

  private mailbox(): string {
    return this.user ? `/users/${encodeURIComponent(this.user)}` : "/me";
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }
}
