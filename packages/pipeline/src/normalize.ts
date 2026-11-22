/**
 * Step 2 — Normalize.
 * Removes quoted earlier messages and signatures so the classifier reads only
 * what the sender just wrote. Deadlines and commitments are not extracted here
 * (deadlines.ts and the classifier do that).
 *
 * Quote and signature detection uses `email-reply-parser` (MIT, no
 * dependencies), which understands Gmail, Apple Mail, and Outlook headers in
 * several languages, "-----Original Message-----", and signatures. On a
 * 15-case set of synthetic message shapes it matched 13 against 6 for the earlier
 * hand-written stripper and 9 for `planer` (`.kiro/specs/build-vs-buy`). It does
 * not remove a forwarded message or a legal disclaimer, so those stay.
 *
 * Nothing is ever lost silently: when the parser leaves nothing visible, the
 * earlier line-based stripper decides, and if that also leaves nothing, the
 * original text is kept.
 */

import EmailReplyParser from "email-reply-parser";

export interface Normalized {
  body: string;
  deadlines: string[];
  commitments: string[];
}

const QUOTE_LINE_RE = /^>/;
const ON_DATE_WROTE_RE = /^On .+? wrote:\s*$/;

/** The earlier, line-based stripper: ">" quote lines and a one-line "On ... wrote:". */
function stripQuoteLines(rawBody: string): string {
  const cleaned: string[] = [];
  let skipNextQuotedBlock = false;
  let inQuotedBlock = false;

  for (const line of rawBody.split("\n")) {
    if (ON_DATE_WROTE_RE.test(line)) {
      skipNextQuotedBlock = true;
      continue;
    }
    if (skipNextQuotedBlock && QUOTE_LINE_RE.test(line)) {
      inQuotedBlock = true;
      continue;
    }
    if (inQuotedBlock && QUOTE_LINE_RE.test(line)) continue;
    if (inQuotedBlock) {
      inQuotedBlock = false;
      skipNextQuotedBlock = false;
    }
    if (QUOTE_LINE_RE.test(line)) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

export function normalize(rawBody: string): Normalized {
  let body = "";
  try {
    body = new EmailReplyParser().read(rawBody).getVisibleText().trim();
  } catch {
    // A parser failure must not stop a signal from being processed.
    body = "";
  }
  if (body === "") body = stripQuoteLines(rawBody);
  if (body === "") body = rawBody.trim();
  return { body, deadlines: [], commitments: [] };
}
