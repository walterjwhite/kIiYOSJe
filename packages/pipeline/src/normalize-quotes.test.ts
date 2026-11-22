import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalDataDir } from "./eval/fixtures.js";
import { normalize } from "./normalize.js";

interface QuoteCase {
  id: string;
  note: string;
  raw: string;
  expected: string;
}

const cases = JSON.parse(readFileSync(join(evalDataDir(), "quotes.json"), "utf8")) as QuoteCase[];
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Shapes the reply parser does not strip. Each is a documented gap, and the test
 * below fails if one starts working so this list gets shortened.
 */
const KNOWN_LEAKS = new Set([
  "forwarded", // the forwarded message is kept: it may be what the operator is asked to act on
  "disclaimer", // a legal footer has no marker a parser can rely on
]);

describe("normalize: quoted replies and signatures", () => {
  it("has real-shaped cases for each mail client and language", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of cases.filter((x) => !KNOWN_LEAKS.has(x.id))) {
    it(`${c.id}: ${c.note}`, () => {
      expect(squash(normalize(c.raw).body)).toBe(squash(c.expected));
    });
  }

  for (const id of KNOWN_LEAKS) {
    it(`${id}: still a known gap`, () => {
      const c = cases.find((x) => x.id === id);
      expect(c).toBeDefined();
      const body = squash(normalize(c?.raw ?? "").body);
      expect(body).toContain(squash(c?.expected ?? ""));
      expect(body).not.toBe(squash(c?.expected ?? ""));
    });
  }

  it("never returns an empty body for a message that has text", () => {
    const allQuoted = "> everything here is a quote\n> and so is this line\n";
    const { body } = normalize(allQuoted);
    // Nothing visible is left, so the operator's text must not be silently lost.
    expect(body.length).toBeGreaterThan(0);
  });

  it("keeps a message that is only a forwarded block", () => {
    const raw =
      "---------- Forwarded message ---------\nFrom: Kim <kim@vendor.test>\n\nPlease pay invoice 7.";
    expect(normalize(raw).body).toContain("Please pay invoice 7.");
  });
});
