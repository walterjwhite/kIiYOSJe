/**
 * Teams message mapping. teams-api returns rich-text HTML and system events;
 * only human-authored text becomes a signal, and the HTML is flattened so the
 * classifier reads words rather than markup.
 */

import type { Conversation, Message } from "teams-api";
import type { NewSignal } from "@mind/core";
import { stripHtml } from "../html.js";

export { stripHtml };

export function isHumanText(message: Message): boolean {
  if (message.isDeleted) return false;
  const type = message.messageType.toLowerCase();
  return type.includes("text") && !type.startsWith("threadactivity");
}

export function toSignal(
  conversation: Conversation,
  message: Message,
): NewSignal | null {
  if (!isHumanText(message)) return null;
  const composedAt = new Date(
    message.composeTime || message.originalArrivalTime,
  );

  return {
    adapter: "teams",
    externalId: message.id,
    threadId: conversation.id,
    sender: message.senderMri || message.senderDisplayName,
    recipients: [conversation.topic].filter((value) => value.length > 0),
    kind: "chat",
    ...(message.subject ? { subject: message.subject } : {}),
    body: stripHtml(message.content),
    receivedAt: Number.isNaN(composedAt.getTime()) ? new Date() : composedAt,
    urgencyHint: message.mentions.length > 0 ? 1 : null,
  };
}
