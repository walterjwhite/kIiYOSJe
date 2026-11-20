/**
 * Finds a link in a message that starts with a prefix the operator declared in
 * a direction's `signalActions` (kind: openLink).
 *
 * The link is opened from untrusted email content, so the match is strict:
 * it must be https, have no credentials or port, and its host and path must
 * equal the prefix's host and path exactly (so look-alike hosts and other
 * paths on the same host are ignored). Query parameters present in the prefix
 * must be present, with a non-empty value, in the found link.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decodes the entities an HTML email puts inside href attributes. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x3d;/gi, "=")
    .replace(/&#61;/g, "=");
}

function validated(candidate: string, prefix: URL): string | undefined {
  // Trailing punctuation from prose ("...adt=abc).") is not part of the URL.
  const trimmed = candidate.replace(/[.,;:!?)\]]+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.host !== prefix.host ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== prefix.pathname
  ) {
    return undefined;
  }
  for (const key of prefix.searchParams.keys()) {
    if (!url.searchParams.get(key)) return undefined;
  }
  return url.toString();
}

/** First matching link in the HTML body, then the plain-text body. */
export function extractLink(
  htmlBody: string | null | undefined,
  body: string | null | undefined,
  linkPrefix: string,
): string | undefined {
  let prefix: URL;
  try {
    prefix = new URL(linkPrefix);
  } catch {
    return undefined;
  }
  if (prefix.protocol !== "https:") return undefined;

  const candidate = new RegExp(`${escapeRegExp(linkPrefix)}[^\\s"'<>]+`, "gi");
  for (const source of [htmlBody, body]) {
    if (!source) continue;
    for (const match of decodeEntities(source).matchAll(candidate)) {
      const ok = validated(match[0], prefix);
      if (ok) return ok;
    }
  }
  return undefined;
}
