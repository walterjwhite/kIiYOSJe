import * as vscode from "vscode";
import * as crypto from "node:crypto";

/**
 * Shared singleton-panel lifecycle for every mockup-section webview
 * (Queue, Signals, Directions, Learnings, Journal — Today/Analytics/Devices
 * already followed this shape before this file existed). One instance per
 * panel id; re-opening a section reveals the existing panel instead of
 * creating a second one.
 */
export abstract class SectionPanel {
  protected readonly panel: vscode.WebviewPanel;

  protected constructor(viewType: string, title: string) {
    this.panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => this.onDispose());
    this.panel.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg));
  }

  reveal(): void {
    this.panel.reveal();
  }

  protected abstract onDispose(): void;
  protected abstract onMessage(msg: unknown): void;

  /** Wraps body HTML in the shared CSP/style shell and returns a nonce for inline scripts. */
  protected shell(title: string, bodyHtml: string, extraStyle = ""): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-src 'self' data:; child-src 'self' data:;">
  <style>
    :root {
      /* Falls back to the theme's own accent-ish colors when a newer
         VS Code version doesn't define --vscode-charts-blue, so this
         still works across older editor versions. Button fills use
         fixed, higher-contrast shades rather than the raw chart colors:
         --vscode-charts-green/red are tuned for small chart swatches on
         the editor background, not for white text on top of a solid
         fill, and fail WCAG AA contrast there. */
      --mind-accent: var(--vscode-charts-blue, var(--vscode-focusBorder, #3b82f6));
      --mind-accent-fg: var(--vscode-button-foreground, #ffffff);
      --mind-green: var(--vscode-charts-green, var(--vscode-gitDecoration-addedResourceForeground, #3fb950));
      --mind-green-fill: #1a7f37;   /* WCAG AA for white text at this weight (GitHub's "Merged" green) */
      --mind-green-fill-hover: #146c2e;
      --mind-yellow: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground, #d29922));
      --mind-red: var(--vscode-charts-red, var(--vscode-errorForeground, #f85149));
      --mind-red-fill: #c0362c;     /* WCAG AA for white text; discard is also a real action, not a disabled-looking outline */
      --mind-red-fill-hover: #a52d24;
      --mind-purple: var(--vscode-charts-purple, #a371f7);
      --mind-row-alt: color-mix(in srgb, var(--vscode-editor-foreground) 4%, transparent);
      --mind-row-hover: color-mix(in srgb, var(--mind-accent) 14%, transparent);
    }

    * { box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      padding: 1.3em 1.6em 2.2em;
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.5;
    }

    h1 {
      font-size: 1.3em;
      margin: 0 0 0.9em;
      display: flex;
      align-items: center;
      gap: 0.5em;
    }
    h1::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mind-accent);
      flex-shrink: 0;
    }

    h2 {
      font-size: 1em;
      margin-top: 1.6em;
      margin-bottom: 0.5em;
      padding-bottom: 0.3em;
      border-bottom: 2px solid var(--mind-accent);
      color: var(--vscode-foreground);
      display: inline-block;
    }

    .sub, .meta { opacity: 0.72; font-size: 0.88em; }

    a { color: var(--mind-accent); }
    a:hover { text-decoration: underline; }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 0.9em;
      border-radius: 6px;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      padding: 7px 10px;
      vertical-align: top;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    th {
      opacity: 0.75;
      text-transform: uppercase;
      font-size: 0.72em;
      letter-spacing: 0.4px;
      background: var(--mind-row-alt);
      border-bottom: 2px solid var(--mind-accent);
    }
    tbody tr:nth-child(even) { background: var(--mind-row-alt); }
    tbody tr {
      transition: background-color 120ms ease, box-shadow 120ms ease;
    }
    /* Every table row is interactive-looking on hover, even when it isn't
       clickable, so hovering a plain data row doesn't look inert next to
       one that is. Rows that are genuinely clickable get the stronger
       accent treatment below. */
    tbody tr:hover {
      background: var(--mind-row-alt);
    }
    tbody tr.clickable, .clickable { cursor: pointer; }
    tbody tr.clickable:hover, .clickable:hover {
      background: var(--mind-row-hover) !important;
      box-shadow: inset 3px 0 0 var(--mind-accent);
    }
    tbody tr.clickable:focus-visible, .clickable:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--mind-accent));
      outline-offset: -2px;
    }
    /* Individual cells inside a clickable row still read as part of one
       target, but a cell that carries its own data-action (e.g. the
       Directions "Signals handled" drill-down cell) gets its own
       highlight so it's clear that specific cell, not the whole row, is
       the thing to click. */
    td.clickable:hover {
      background: var(--mind-row-hover);
      box-shadow: inset 0 0 0 1px var(--mind-accent);
    }

    button {
      cursor: pointer;
      padding: 5px 12px;
      font-size: 0.9em;
      font-weight: 500;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      transition: background-color 120ms ease, transform 80ms ease, box-shadow 120ms ease;
    }
    button:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground, var(--mind-accent));
      box-shadow: 0 1px 4px color-mix(in srgb, var(--mind-accent) 35%, transparent);
    }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--mind-accent));
      outline-offset: 2px;
    }

    /* Approve/accept: a solid fill dark enough that white text clears WCAG
       AA contrast (the raw --vscode-charts-green chart color does not). */
    button[data-action="approve"], button[data-action="accept"] {
      background: var(--mind-green-fill);
      color: #ffffff;
      border-color: transparent;
    }
    button[data-action="approve"]:hover:not(:disabled), button[data-action="accept"]:hover:not(:disabled) {
      background: var(--mind-green-fill-hover);
      box-shadow: 0 1px 4px color-mix(in srgb, var(--mind-green-fill) 45%, transparent);
    }

    /* Discard/reject/undo: a real action, not a disabled-looking ghost
       button — a solid fill at the same weight as approve, distinguished
       by color rather than by one being filled and the other outlined. */
    button[data-action="discard"], button[data-action="reject"], button[data-action="undo"] {
      background: var(--mind-red-fill);
      color: #ffffff;
      border-color: transparent;
    }
    button[data-action="discard"]:hover:not(:disabled), button[data-action="reject"]:hover:not(:disabled), button[data-action="undo"]:hover:not(:disabled) {
      background: var(--mind-red-fill-hover);
      box-shadow: 0 1px 4px color-mix(in srgb, var(--mind-red-fill) 45%, transparent);
    }

    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 1em;
    }

    .empty {
      opacity: 0.65;
      font-style: italic;
      padding: 0.9em 1em;
      background: var(--mind-row-alt);
      border-radius: 6px;
      border-left: 3px solid var(--vscode-widget-border);
    }

    .badge {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 10px;
      font-size: 0.76em;
      font-weight: 600;
      background: color-mix(in srgb, var(--mind-accent) 22%, var(--vscode-badge-background));
      color: var(--vscode-foreground);
    }

    .card {
      border: 1px solid var(--vscode-widget-border);
      border-left: 3px solid var(--mind-accent);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
      transition: box-shadow 150ms ease, border-color 150ms ease;
    }
    .card:hover {
      box-shadow: 0 2px 10px color-mix(in srgb, var(--mind-accent) 20%, transparent);
      border-left-color: var(--mind-accent);
    }
    .insight-card {
      border-left-color: var(--mind-purple);
      background: color-mix(in srgb, var(--mind-purple) 6%, var(--vscode-editor-background));
    }

    .notice {
      background: color-mix(in srgb, var(--mind-accent) 12%, var(--vscode-editor-background));
      border: 1px solid var(--mind-accent);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 1.2em;
      font-size: 0.95em;
    }

    .danger { color: var(--mind-red); font-weight: 500; }

    .bar-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      transition: background-color 120ms ease;
    }
    .bar-row:nth-child(even) { background: var(--mind-row-alt); }
    .bar-row:hover {
      background: var(--mind-row-hover) !important;
      box-shadow: inset 3px 0 0 var(--mind-accent);
    }
    .bar-label { opacity: 0.9; flex: 0 0 140px; }
    .bar-track {
      flex: 1;
      height: 8px;
      border-radius: 4px;
      background: var(--mind-row-alt);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--mind-accent), var(--mind-purple));
      border-radius: 4px;
      transition: width 200ms ease;
    }
    .bar-value { font-weight: 600; flex: 0 0 auto; min-width: 2.2em; text-align: right; }

    .pairing-panel {
      border: 1px dashed var(--vscode-widget-border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-top: 0.5em;
      opacity: 0.85;
    }
    .pairing-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 4px;
      text-align: center;
      padding: 10px 0;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      margin-bottom: 10px;
      color: var(--mind-accent);
    }

    /* A signal's original HTML body, rendered natively in a maximally
       sandboxed iframe (sandbox="" — no scripts, no same-origin, no
       navigation) since mail HTML is untrusted content. */
    .html-body-frame {
      width: 100%;
      min-height: 320px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      background: #ffffff;
      margin-bottom: 0.9em;
    }

    /* Toggle switch — replaces a separate "Toggle" button. */
    .switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      cursor: pointer;
      vertical-align: middle;
    }
    .switch:hover .switch-track {
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--mind-accent) 30%, transparent);
    }
    .switch:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--mind-accent));
      outline-offset: 2px;
      border-radius: 10px;
    }
    .switch-track {
      position: absolute;
      inset: 0;
      border-radius: 10px;
      background: var(--vscode-widget-border);
      transition: background-color 150ms ease;
    }
    .switch.on .switch-track { background: var(--mind-green); }
    .switch-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--vscode-editor-background);
      transition: left 150ms ease;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .switch.on .switch-thumb { left: 18px; }

    /* Inline-editable field — click the value to edit in place, no
       separate Edit button. Enter or blur commits; Escape cancels. */
    .editable {
      display: inline-block;
      min-width: 2em;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: text;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .editable:hover {
      border-color: var(--mind-accent);
      background: var(--mind-row-alt);
    }
    .editable[contenteditable="true"] {
      border-color: var(--mind-accent);
      background: var(--vscode-input-background);
      outline: none;
      cursor: text;
    }
    .editable-hint {
      font-size: 0.75em;
      opacity: 0.55;
      margin-left: 6px;
    }
    .editable:hover .editable-hint { opacity: 0.8; }

    /* "Open in editor" link for long/Markdown fields — real syntax
       highlighting comes from opening an actual text editor tab, not a
       webview textarea. */
    .open-editor-link {
      font-size: 0.85em;
      margin-left: 8px;
    }

    @media (max-width: 640px) {
      body { padding: 1em 1em 2em; }
      .bar-label { flex-basis: 90px; font-size: 0.85em; }
      th, td { padding: 5px 6px; font-size: 0.85em; }
      .toolbar { gap: 6px; }
    }

    ${extraStyle}
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${bodyHtml}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function post(msg) { vscode.postMessage(msg); }

  // Keyboard accessibility: every clickable row/link gets a tab stop and
  // responds to Enter, without every panel template having to add
  // tabindex by hand.
  function makeClickablesFocusable() {
    document.querySelectorAll('.clickable, tr.clickable').forEach(function(el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  }
  makeClickablesFocusable();
  new MutationObserver(makeClickablesFocusable).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.clickable, tr.clickable');
    if (!el || el.isContentEditable) return;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return; // native activation already handles these
    e.preventDefault();
    el.click();
  });

  document.addEventListener('click', function(e) {
    const switchEl = e.target.closest('.switch');
    if (switchEl && !e.target.closest('.editable')) {
      const action = switchEl.getAttribute('data-action');
      if (action) {
        const msg = { command: action };
        for (const attr of switchEl.attributes) {
          if (attr.name.startsWith('data-') && attr.name !== 'data-action') {
            msg[attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr.value;
          }
        }
        post(msg);
      }
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || el.classList.contains('editable')) return;
    const action = el.getAttribute('data-action');
    const msg = { command: action };
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.name !== 'data-action' && attr.name !== 'data-value-from') {
        msg[attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr.value;
      }
    }
    const valueFromSelector = el.getAttribute('data-value-from');
    if (valueFromSelector) {
      const sourceEl = document.querySelector(valueFromSelector);
      if (sourceEl) {
        msg.text = sourceEl.value;
        sourceEl.value = '';
      }
    }
    post(msg);
  });

  // Inline-editable fields: click to focus and edit in place. Enter or
  // losing focus commits; Escape reverts to the last-known value.
  document.addEventListener('click', function(e) {
    const el = e.target.closest('.editable[data-edit-action]');
    if (!el || el.getAttribute('contenteditable') === 'true') return;
    beginEdit(el);
  });

  function beginEdit(el) {
    el.dataset.originalText = el.textContent;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    document.execCommand('selectAll', false, null);
  }

  function commitEdit(el) {
    el.removeAttribute('contenteditable');
    const action = el.getAttribute('data-edit-action');
    const value = el.textContent.trim();
    if (value === el.dataset.originalText) return;
    const msg = { command: action, value };
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.name !== 'data-edit-action' && attr.name !== 'data-original-text') {
        msg[attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr.value;
      }
    }
    post(msg);
  }

  document.addEventListener('focusout', function(e) {
    const el = e.target.closest('.editable[contenteditable="true"]');
    if (el) commitEdit(el);
  });
  document.addEventListener('keydown', function(e) {
    const el = e.target.closest('.editable[contenteditable="true"]');
    if (el) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        el.textContent = el.dataset.originalText;
        el.blur();
      }
      return;
    }
    const switchEl = e.target.closest('.switch');
    if (switchEl && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      switchEl.click();
    }
  });
</script>
</body>
</html>`;
  }
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A toggle switch — posts `action` with the given data attributes on click or Enter/Space when focused. No separate label needed; pair it with text in the caller. */
export function toggleSwitch(
  on: boolean,
  action: string,
  data: Record<string, string>,
): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${esc(v)}"`)
    .join(" ");
  return `<span class="switch ${on ? "on" : ""}" data-action="${esc(action)}" ${attrs} role="switch" aria-checked="${on}" tabindex="0">
    <span class="switch-track"></span><span class="switch-thumb"></span>
  </span>`;
}

/**
 * A short inline-editable value — click it to edit in place, commits on
 * Enter/blur, posts `editAction` with `value` plus the given data
 * attributes. For single-line values; use `openInEditorLink` for anything
 * long enough to want real syntax highlighting.
 */
export function editableField(
  value: string,
  editAction: string,
  data: Record<string, string>,
): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${esc(v)}"`)
    .join(" ");
  return `<span class="editable" data-edit-action="${esc(editAction)}" ${attrs} tabindex="0">${esc(value)}<span class="editable-hint">✎</span></span>`;
}

/** A link that posts `action` — used to open a long/Markdown field as a real editor tab instead of a webview textarea. */
export function openInEditorLink(
  label: string,
  action: string,
  data: Record<string, string>,
): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${esc(v)}"`)
    .join(" ");
  return `<a href="#" class="open-editor-link clickable" data-action="${esc(action)}" ${attrs}>${esc(label)}</a>`;
}
