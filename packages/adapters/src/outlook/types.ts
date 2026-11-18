/**
 * Neutral Outlook mail shape. Both transports (Outlook Web and Microsoft
 * Graph) map into it, so the pipeline never sees a vendor payload.
 */

export interface OutlookMail {
  id: string;
  threadId?: string;
  subject?: string;
  /** Lowercased sender address. */
  from: string;
  /** Lowercased recipient addresses. */
  to: string[];
  receivedAt: Date;
  body: string;
  urgencyHint?: number | null;
}

/** Microsoft Graph message payload (subset of the `$select` we request). */
export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  isRead?: boolean;
  importance?: string;
}
