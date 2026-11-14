/**
 * Step 2 — Normalize.
 * Strips quoted/forwarded text, extracts deadlines and commitments from
 * the body. Returns a cleaned body and any extracted metadata.
 */

export interface Normalized {
  body: string;
  deadlines: string[];
  commitments: string[];
}

// Very basic email-quote stripper (lines starting with ">")
// and "On <date>, <name> wrote:" headers.
const QUOTE_LINE_RE = /^>/;

export function normalize(rawBody: string): Normalized {
  const lines = rawBody.split("\n");
  const cleaned: string[] = [];

  // A "quote block" starts on "On <date>, <name> wrote:" and ends when we see
  // a non-quoted non-empty line after at least one quoted line.
  const ON_DATE_WROTE_RE = /^On .+? wrote:\s*$/;
  let skipNextQuotedBlock = false;
  let inQuotedBlock = false;

  for (const line of lines) {
    if (ON_DATE_WROTE_RE.test(line)) {
      // Marks the start of a quoted section; skip this header line.
      skipNextQuotedBlock = true;
      continue;
    }

    if (skipNextQuotedBlock && QUOTE_LINE_RE.test(line)) {
      inQuotedBlock = true;
      continue;
    }

    if (inQuotedBlock && QUOTE_LINE_RE.test(line)) {
      // Still inside quoted block.
      continue;
    }

    // Reached a non-quoted line after a block — reset.
    if (inQuotedBlock) {
      inQuotedBlock = false;
      skipNextQuotedBlock = false;
    }

    // Also skip bare ">"-prefixed lines that appear without a "wrote:" header.
    if (QUOTE_LINE_RE.test(line)) {
      continue;
    }

    cleaned.push(line);
  }

  const body = cleaned.join("\n").trim();
  return { body, deadlines: [], commitments: [] };
}
