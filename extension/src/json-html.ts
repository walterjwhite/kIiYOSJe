/**
 * JSON to syntax-highlighted HTML. Pure, no vscode import, unit-tested.
 *
 * Every piece of text is HTML-escaped; only the wrapping <span class="j-*">
 * tags are added. The classes are styled in webview-base.ts.
 */

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const span = (cls: string, text: string): string => `<span class="${cls}">${escape(text)}</span>`;

function render(value: unknown, indent: number, depth: number, out: string[]): void {
  if (value === null || value === undefined) {
    out.push(span("j-null", "null"));
  } else if (typeof value === "string") {
    out.push(span("j-str", JSON.stringify(value)));
  } else if (typeof value === "number") {
    out.push(span("j-num", String(value)));
  } else if (typeof value === "boolean") {
    out.push(span("j-bool", String(value)));
  } else if (Array.isArray(value)) {
    if (value.length === 0) return void out.push(span("j-punct", "[]"));
    const pretty = indent > 0;
    out.push(span("j-punct", "["));
    value.forEach((item, i) => {
      if (pretty) out.push("\n" + " ".repeat(indent * (depth + 1)));
      render(item, indent, depth + 1, out);
      if (i < value.length - 1) out.push(span("j-punct", pretty ? "," : ", "));
    });
    if (pretty) out.push("\n" + " ".repeat(indent * depth));
    out.push(span("j-punct", "]"));
  } else if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return void out.push(span("j-punct", "{}"));
    const pretty = indent > 0;
    out.push(span("j-punct", "{"));
    entries.forEach(([k, v], i) => {
      if (pretty) out.push("\n" + " ".repeat(indent * (depth + 1)));
      else if (i === 0) out.push(" ");
      out.push(span("j-key", JSON.stringify(k)), span("j-punct", ": "));
      render(v, indent, depth + 1, out);
      if (i < entries.length - 1) out.push(span("j-punct", pretty ? "," : ", "));
    });
    if (pretty) out.push("\n" + " ".repeat(indent * depth));
    else out.push(" ");
    out.push(span("j-punct", "}"));
  } else {
    out.push(span("j-str", String(value)));
  }
}

/** Highlighted HTML for a value. `indent` 0 gives a single line, 2 gives a pretty-printed block. */
export function jsonToHtml(value: unknown, indent = 0): string {
  const out: string[] = [];
  render(value, indent, 0, out);
  return out.join("");
}

/**
 * Highlighted HTML for a JSON string. Text that is not valid JSON is returned
 * escaped and unhighlighted rather than dropped.
 */
export function jsonTextToHtml(text: string, indent = 0): string {
  try {
    return jsonToHtml(JSON.parse(text), indent);
  } catch {
    return escape(text);
  }
}
