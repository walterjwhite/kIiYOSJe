/** Microsoft Graph mail transport (opt-in: `outlook.backend: graph`). */

import type { OutboundDraft, SendResult } from "@mind/core";
import { outlookCredentials, outlookTokenFor } from "./auth.js";
import { OutlookClient } from "./client.js";
import { fromGraph } from "./mapper.js";
import type { OutlookMailSource } from "./source.js";
import type { OutlookMail } from "./types.js";

export class GraphMailSource implements OutlookMailSource {
  readonly backend = "graph" as const;
  private readonly client: OutlookClient;

  constructor(client?: OutlookClient, account = "default") {
    this.client =
      client ??
      new OutlookClient(
        () => outlookTokenFor(account),
        outlookCredentials(account)?.user,
      );
  }

  static forAccount(account: string): GraphMailSource {
    return new GraphMailSource(undefined, account);
  }

  async listUnread(since: Date, limit = 25): Promise<OutlookMail[]> {
    const messages = await this.client.listUnread(since, limit);
    return messages.map(fromGraph);
  }

  send(draft: OutboundDraft): Promise<SendResult> {
    return this.client.send(draft);
  }
}
