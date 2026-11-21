/**
 * Outlook mail mapping. Pure functions, so both transports are covered by tests
 * without a mailbox.
 */

import type { NewSignal } from "@mind/core";
import { adapterIdForAccount } from "@mind/core";
import { stripHtml } from "../html.js";
import type { GraphMessage, OutlookMail } from "./types.js";

export { stripHtml };

export function toSignal(mail: OutlookMail, account = "default"): NewSignal {
  return {
    adapter: adapterIdForAccount("outlook", account),
    account,
    externalId: mail.id,
    ...(mail.internetMessageId ? { dedupeId: `message-id:${mail.internetMessageId}` } : {}),
    threadId: mail.threadId ?? null,
    sender: mail.from,
    recipients: mail.to,
    ...(mail.cc && mail.cc.length > 0 ? { cc: mail.cc } : {}),
    ...(mail.bcc && mail.bcc.length > 0 ? { bcc: mail.bcc } : {}),
    kind: "email",
    ...(mail.subject ? { subject: mail.subject } : {}),
    body: mail.body,
    ...(mail.htmlBody ? { htmlBody: mail.htmlBody } : {}),
    receivedAt: mail.receivedAt,
    urgencyHint: mail.urgencyHint ?? null,
  };
}

/** Microsoft Graph message to the neutral shape. */
export function fromGraph(message: GraphMessage): OutlookMail {
  const htmlContent =
    message.body?.contentType?.trim().toLowerCase() === "html" ? message.body?.content : undefined;

  return {
    id: message.id,
    ...(message.conversationId ? { threadId: message.conversationId } : {}),
    ...(message.internetMessageId
      ? {
          internetMessageId: message.internetMessageId.trim().replace(/^<|>$/g, "").toLowerCase(),
        }
      : {}),
    ...(message.subject ? { subject: message.subject } : {}),
    from: address(message.from?.emailAddress?.address) || "unknown",
    to: (message.toRecipients ?? [])
      .map((recipient) => address(recipient.emailAddress?.address))
      .filter((value) => value.length > 0),
    ...(() => {
      const cc = (message.ccRecipients ?? [])
        .map((recipient) => address(recipient.emailAddress?.address))
        .filter((value) => value.length > 0);
      return cc.length > 0 ? { cc } : {};
    })(),
    ...(() => {
      const bcc = (message.bccRecipients ?? [])
        .map((recipient) => address(recipient.emailAddress?.address))
        .filter((value) => value.length > 0);
      return bcc.length > 0 ? { bcc } : {};
    })(),
    receivedAt: parseDate(message.receivedDateTime),
    body: bodyText(message.body?.contentType, message.body?.content ?? message.bodyPreview ?? ""),
    ...(htmlContent ? { htmlBody: htmlContent } : {}),
    urgencyHint: message.importance === "high" ? 1 : null,
  };
}

function address(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function bodyText(contentType: string | undefined, content: string): string {
  return contentType?.trim().toLowerCase() === "html" ? stripHtml(content) : content;
}

function parseDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
