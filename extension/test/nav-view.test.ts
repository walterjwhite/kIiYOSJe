import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_ITEMS } from "../src/nav-items.js";
import { NAV_ICONS, navCommandFor, navHtml } from "../src/nav-view.js";

describe("sidebar view", () => {
  const html = navHtml("abc123");

  it("renders one link per section, by name only", () => {
    for (const item of NAV_ITEMS) {
      expect(html).toContain(`data-id="${item.id}"`);
      expect(html).toContain(`>${item.label}</span>`);
    }
  });

  it("keeps System Events and Model Trace inside a collapsed Developer group", () => {
    const group = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(group).not.toMatch(/<details[^>]*\sopen/);
    expect(group).toContain('data-id="systemEvents"');
    expect(group).toContain('data-id="modelTrace"');
    expect(group).not.toContain('data-id="queue"');
    expect(group).toContain(NAV_GROUPS[0]?.label ?? "Developer");
  });

  it("lines the Developer icon up with the other links, indenting only its children", () => {
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    // The expand arrow sits after the label, so it does not push the icon right.
    expect(summary.indexOf('class="chevron"')).toBeGreaterThan(summary.indexOf("<span>"));
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(css).toMatch(/\.nav-children \.nav-row\s*\{[^}]*padding-left/);
  });

  it("has an icon for every item and group", () => {
    for (const entry of [...NAV_ITEMS, ...NAV_GROUPS]) expect(NAV_ICONS[entry.icon]).toBeTruthy();
  });

  it("adds color on hover and focus only, not at rest", () => {
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const rest = css.slice(css.indexOf(".nav-row {"), css.indexOf("}", css.indexOf(".nav-row {")));
    expect(rest).not.toContain("color-mix");
    expect(rest).not.toContain("--mind-accent");
    expect(css).toMatch(/\.nav-row:hover[^{]*\{[^}]*color-mix/);
    expect(css).toMatch(/\.nav-row:focus-visible/);
  });

  it("loads nothing remote and runs only its own nonce'd script", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123">');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("opens only commands that belong to a nav item", () => {
    expect(navCommandFor("queue")).toBe("mind.queue");
    expect(navCommandFor("modelTrace")).toBe("mind.modelTrace");
    expect(navCommandFor("workbench.action.quit")).toBeUndefined();
    expect(navCommandFor(42)).toBeUndefined();
  });
});
