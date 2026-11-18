/**
 * The mail transport the Outlook adapter polls. Graph and Outlook Web both
 * implement it, so the adapter only knows this contract.
 */

import type { OutboundDraft, SendResult } from "@mind/core";
import type { OutlookBackendName } from "./backend.js";
import type { OutlookMail } from "./types.js";

export interface OutlookMailSource {
  readonly backend: OutlookBackendName;
  listUnread(since: Date, limit?: number): Promise<OutlookMail[]>;
  send(draft: OutboundDraft): Promise<SendResult>;
}
