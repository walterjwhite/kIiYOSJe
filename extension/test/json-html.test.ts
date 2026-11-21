import { describe, expect, it } from "vitest";
import { jsonTextToHtml, jsonToHtml } from "../src/json-html.js";

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("jsonToHtml", () => {
  it("wraps each token type in its own class", () => {
    const html = jsonToHtml({ a: "x", b: 1, c: true, d: null });
    expect(html).toContain('class="j-key">&quot;a&quot;');
    expect(html).toContain('class="j-str">&quot;x&quot;');
    expect(html).toContain('class="j-num">1');
    expect(html).toContain('class="j-bool">true');
    expect(html).toContain('class="j-null">null');
  });

  it("escapes markup in keys and values", () => {
    const html = jsonToHtml({ "<k>": "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;k&gt;");
  });

  it("pretty output matches JSON.stringify(_, null, 2) once tags are removed", () => {
    const v = { a: [1, { b: "c" }, []], d: {}, e: "f" };
    expect(strip(jsonToHtml(v, 2))).toBe(JSON.stringify(v, null, 2));
  });

  it("compact output stays on one line", () => {
    expect(jsonToHtml({ a: [1, 2] })).not.toContain("\n");
  });
});

describe("jsonTextToHtml", () => {
  it("highlights valid JSON", () => {
    expect(jsonTextToHtml('{"a":1}')).toContain("j-key");
  });
  it("returns invalid JSON escaped and unhighlighted", () => {
    expect(jsonTextToHtml("not <json>")).toBe("not &lt;json&gt;");
  });
});
