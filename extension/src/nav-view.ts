import { NAV_ITEMS, type NavItem, navChildren, navTopLevel } from "./nav-items.js";

/**
 * The sidebar's HTML, without the vscode import so it can be tested.
 *
 * It is a webview rather than a tree view because a tree view's rows belong to
 * VS Code: an extension cannot color them on hover. A webview can. Rows have no
 * color at rest, so the sidebar stays as quiet as before; the accent appears
 * only under the pointer or keyboard focus.
 */

/** Inner SVG for each icon name in nav-items.ts, drawn on a 24x24 grid with a 1.6 stroke. */
export const NAV_ICONS: Readonly<Record<string, string>> = {
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/>',
  rss: '<circle cx="6" cy="18" r="1.4"/><path d="M5 11a8 8 0 0 1 8 8"/><path d="M5 5a14 14 0 0 1 14 14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  lightbulb:
    '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6h6c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3z"/>',
  graph: '<path d="M5 20v-8"/><path d="M12 20V5"/><path d="M19 20v-6"/>',
  book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12"/>',
  "list-unordered":
    '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
  "type-hierarchy":
    '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4"/><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  "device-desktop":
    '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  gear: '<circle cx="12" cy="12" r="4"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M16.3 16.3l2.1 2.1"/><path d="M5.6 18.4l2.1-2.1"/><path d="M16.3 7.7l2.1-2.1"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  beaker:
    '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
};

const STYLE = `
  :root { --mind-accent: var(--vscode-charts-blue, var(--vscode-focusBorder, #3b82f6)); }
  body { margin: 0; padding: 4px 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .nav-row {
    display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
    padding: 4px 12px; border: 0; border-left: 2px solid transparent; background: transparent;
    color: inherit; font: inherit; text-align: left; cursor: pointer; list-style: none;
  }
  .nav-row::-webkit-details-marker { display: none; }
  .nav-row svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .nav-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-row:hover, .nav-row:focus-visible { background: color-mix(in srgb, var(--mind-accent) 16%, transparent); border-left-color: var(--mind-accent); }
  .nav-row:hover svg, .nav-row:focus-visible svg { color: var(--mind-accent); }
  .nav-row:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--mind-accent)); outline-offset: -1px; }
  .chevron { width: 12px; height: 12px; transition: transform 120ms ease; }
  details[open] > summary .chevron { transform: rotate(90deg); }
  .nav-children .nav-row { padding-left: 34px; }
`;

const SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-id]');
    if (link) vscode.postMessage({ command: 'open', id: link.getAttribute('data-id') });
  });
  // Up and Down move between the rows that are showing, as in a native list.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var rows = Array.prototype.filter.call(document.querySelectorAll('.nav-row'), function (r) { return r.offsetParent !== null; });
    var at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    var next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
  });
})();
`;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function icon(name: string, className = ""): string {
  return `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[name] ?? ""}</svg>`;
}

function link(item: NavItem): string {
  return `<button class="nav-row nav-link" data-id="${esc(item.id)}">${icon(item.icon)}<span>${esc(item.label)}</span></button>`;
}

/** The sidebar document. `nonce` is the per-render CSP nonce for its one script. */
export function navHtml(nonce: string): string {
  const rows = navTopLevel()
    .map((row) => {
      if (row.kind === "item") return link(row.item);
      const { group } = row;
      return `<details class="nav-group">
        <summary class="nav-row">${icon("chevron", "chevron")}${icon(group.icon)}<span>${esc(group.label)}</span></summary>
        <div class="nav-children">${navChildren(group.id).map(link).join("")}</div>
      </details>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>${STYLE}</style>
</head>
<body>
  <nav aria-label="mind sections">
${rows}
  </nav>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

/**
 * The command a sidebar click opens. Only the commands of nav items qualify, so
 * the page cannot ask the extension to run anything else.
 */
export function navCommandFor(id: unknown): string | undefined {
  return typeof id === "string" ? NAV_ITEMS.find((item) => item.id === id)?.command : undefined;
}
