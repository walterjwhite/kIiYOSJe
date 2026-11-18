/**
 * Outlook mail mapping. Pure functions, so both transports are covered by tests
 * without a mailbox.
 */

import type { NewSignal } from "@mind/core";
import { stripHtml } from "../html.js";
import type { GraphMessage, OutlookMail } from "./types.js";

export { stripHtml };

export function toSignal(mail: OutlookMail): NewSignal {
  return {
    adapter: "outlook",
    externalId: mail.id,
    threadId: mail.threadId ?? null,
    sender: mail.from,
    recipients: mail.to,
    kind: "email",
    ...(mail.subject ? { subject: mail.subject } : {}),
    body: mail.body,
    receivedAt: mail.receivedAt,
    urgencyHint: mail.urgencyHint ?? null,
  };
}

/** Microsoft Graph message to the neutral shape. */
export function fromGraph(message: GraphMessage): OutlookMail {
  return {
    id: message.id,
    ...(message.conversationId ? { threadId: message.conversationId } : {}),
    ...(message.subject ? { subject: message.subject } : {}),
    from: address(message.from?.emailAddress?.address) || "unknown",
    to: (message.toRecipients ?? [])
      .map((recipient) => address(recipient.emailAddress?.address))
      .filter((value) => value.length > 0),
    receivedAt: parseDate(message.receivedDateTime),
    body: bodyText(
      message.body?.contentType,
      message.body?.content ?? message.bodyPreview ?? "",
    ),
    urgencyHint: message.importance === "high" ? 1 : null,
  };
}

function address(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function bodyText(contentType: string | undefined, content: string): string {
  return contentType?.trim().toLowerCase() === "html"
    ? stripHtml(content)
    : content;
}

function parseDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
