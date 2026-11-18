/** Microsoft Graph mail transport (opt-in: `outlook.backend: graph`). */

import type { OutboundDraft, SendResult } from "@mind/core";
import { outlookCredentials, outlookToken } from "./auth.js";
import { OutlookClient } from "./client.js";
import { fromGraph } from "./mapper.js";
import type { OutlookMailSource } from "./source.js";
import type { OutlookMail } from "./types.js";

export class GraphMailSource implements OutlookMailSource {
  readonly backend = "graph" as const;

  constructor(
    private readonly client: OutlookClient = new OutlookClient(
      () => outlookToken(),
      outlookCredentials()?.user,
    ),
  ) {}

  async listUnread(since: Date, limit = 25): Promise<OutlookMail[]> {
    const messages = await this.client.listUnread(since, limit);
    return messages.map(fromGraph);
  }

  send(draft: OutboundDraft): Promise<SendResult> {
    return this.client.send(draft);
  }
}
