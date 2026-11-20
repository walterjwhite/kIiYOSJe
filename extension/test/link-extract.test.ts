import { describe, expect, it } from "vitest";
import { extractLink } from "../src/link-extract.js";

const PREFIX = "https://accounts.google.com/AccountDisavow?adt=";
const LINK = `${PREFIX}AOX8kiq-abc_123`;
const find = (html: string | null, body: string | null) => extractLink(html, body, PREFIX);

describe("extractLink", () => {
  it("finds the link in a plain-text body and strips trailing punctuation", () => {
    expect(find(null, `If this wasn't you, go to ${LINK}.`)).toBe(LINK);
  });

  it("finds the link in HTML and decodes &amp; in the query", () => {
    expect(find(`<a href="${LINK}&amp;rfn=1">No</a>`, "")).toBe(`${LINK}&rfn=1`);
  });

  it("prefers the HTML body over the plain body", () => {
    expect(find(`<a href="${LINK}">x</a>`, `${PREFIX}OTHER`)).toBe(LINK);
  });

  it.each([
    ["look-alike host", "https://accounts.google.com.evil.example/AccountDisavow?adt=x"],
    ["userinfo trick", "https://accounts.google.com@evil.example/AccountDisavow?adt=x"],
    ["http scheme", "http://accounts.google.com/AccountDisavow?adt=x"],
    ["other path", "https://accounts.google.com/SignOutOptions?adt=x"],
    ["empty adt", "https://accounts.google.com/AccountDisavow?adt="],
  ])("rejects %s", (_name, url) => {
    expect(find(null, `see ${url}`)).toBeUndefined();
  });

  it("works for any declared prefix, not just Google", () => {
    const p = "https://example.org/unsubscribe?t=";
    expect(extractLink(null, `x ${p}abc y`, p)).toBe(`${p}abc`);
  });

  it("refuses a non-https prefix", () => {
    expect(extractLink(null, "http://a.test/x?t=1", "http://a.test/x?t=")).toBeUndefined();
  });

  it("returns undefined when there is no link", () => {
    expect(find("<p>hi</p>", "hi")).toBeUndefined();
  });
});
