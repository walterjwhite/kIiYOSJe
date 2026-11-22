/**
 * Gmail payload mapping. Pure functions: headers, MIME walking, and the
 * conversion to a NewSignal, so the shape of Google's payload is exercised in
 * tests without network access.
 */

import { parseAddressList } from "email-addresses";
import type { NewSignal } from "@mind/core";
import { adapterIdForAccount } from "@mind/core";

export interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
  /** Populated by the client after MIME walking. */
  body?: string;
}

export function header(headers: GmailPart["headers"], name: string): string {
  return headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Returns the first text/plain body in the tree, falling back to any body.
 * Text is preferred over HTML whatever order the parts arrive in.
 */
export function extractBody(part: GmailPart | undefined): string {
  return findDecoded(part, "text/plain") ?? findDecoded(part) ?? "";
}

/** The first text/html body in the tree, for native rendering alongside the plain-text extract. */
export function extractHtmlBody(part: GmailPart | undefined): string | undefined {
  return findDecoded(part, "text/html");
}

function findDecoded(part: GmailPart | undefined, mimeType?: string): string | undefined {
  if (!part) return undefined;
  if (part.body?.data && (mimeType === undefined || part.mimeType === mimeType)) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const text = findDecoded(child, mimeType);
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * Address list from a From/To/Cc header, as lowercase addresses.
 *
 * Parsed with `email-addresses` (MIT, RFC 5322), so a quoted display name with a
 * comma ("Doe, Jane" <jane@example.test>) and address groups are read correctly.
 * Real mail headers are sometimes malformed; then the older comma split is used,
 * so one bad header never drops a sender.
 */
export function parseAddresses(value: string): string[] {
  const parsed = parseAddressList(value);
  if (parsed === null) return splitAddresses(value);
  return parsed
    .flatMap((entry) =>
      entry.type === "group" ? entry.addresses.map((a) => a.address) : [entry.address],
    )
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.includes("@"));
}

function splitAddresses(value: string): string[] {
  return value
    .split(",")
    .map((address) => {
      const angled = /<([^>]+)>/.exec(address);
      return (angled?.[1] ?? address).trim().toLowerCase();
    })
    .filter((address) => address.includes("@"));
}

export function toSignal(
  message: GmailMessage,
  selfAddress: string,
  account = "default",
): NewSignal {
  const headers = message.payload?.headers;
  const from = header(headers, "from");
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)) : new Date();
  const messageId = header(headers, "message-id").trim().replace(/^<|>$/g, "").toLowerCase();
  const cc = parseAddresses(header(headers, "cc"));
  const bcc = parseAddresses(header(headers, "bcc"));
  const htmlBody = extractHtmlBody(message.payload);

  return {
    adapter: adapterIdForAccount("gmail", account),
    account,
    externalId: message.id,
    ...(messageId ? { dedupeId: `message-id:${messageId}` } : {}),
    threadId: message.threadId,
    sender: parseAddresses(from)[0] ?? from,
    recipients: parseAddresses(header(headers, "to")),
    ...(cc.length > 0 ? { cc } : {}),
    ...(bcc.length > 0 ? { bcc } : {}),
    kind: "email",
    subject: header(headers, "subject"),
    body: message.body ?? extractBody(message.payload),
    ...(htmlBody ? { htmlBody } : {}),
    receivedAt,
    urgencyHint: message.labelIds?.includes("IMPORTANT") ? 1 : null,
  };
}

/** Minimal RFC 5322 message; Gmail accepts base64url `raw` uploads. */
export function buildRawMessage(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
}): string {
  const lines = [
    ...(input.from ? [`From: ${input.from}`] : []),
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    "",
    input.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
