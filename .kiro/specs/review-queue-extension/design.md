# Design — review queue extension

## Shape

A dedicated Activity Bar container (`mind`) holding one tree of section links.
Every section opens as its own webview panel in the editor area; the tree itself
shows no data and no counts. `System Events` and `Model Trace` sit under a
collapsed **Developer** group so the machine's view is not on the default path.
Everything is driven by `ApiClient`, a thin typed wrapper over the local HTTP API
with the bearer token attached.

```
extension/
  src/extension.ts          activation, command registration, panel commands
  src/api-client.ts         fetch wrapper, token read, error mapping
  src/nav-items.ts          sidebar structure (pure, testable)
  src/nav-provider.ts       sidebar tree: section links + Developer group
  src/webview-base.ts       shared panel lifecycle, CSP shell, controls
  src/queue-panel.ts        Queue: goals column, unlinked column, summary strip
  src/queue-detail-panel.ts conversation, thought, history, actions
  src/goals.ts              pure goal helpers (flags, sorting, sub-goal tree, splitting items)
  src/signals-panel.ts      every signal, inbound and outbound
  src/signal-detail-panel.ts  one signal, including its processing trace
  src/directions-panel.ts   Direction table + editable detail + preview dry run
  src/preview-model.ts      pure rows/caption for POST /directions/preview
  src/learnings-panel.ts    proposals and the reclassification log
  src/analytics-panel.ts    coverage curve, per-Direction rates, flow, daily volume
  src/coverage-model.ts     pure geometry and wording for the coverage curve
  src/flow-model.ts         pure channel → Direction → outcome graph
  src/flow-script.ts        browser-side flow renderer
  src/model-trace-panel.ts  Model Trace graph (data from signal.processed events)
  src/trace-model.ts        pure aggregation behind the graph
  src/json-html.ts          pure JSON highlighter used by System Events and others
  src/devices-panel.ts      placeholder webview
  src/ai-config.ts          provider QuickPick + settings write
  src/notifications-config.ts  quiet-period QuickPick flow
```

## Data flow

1. Activation registers commands and creates the sidebar tree (links only).
2. A section command opens (or reveals) its singleton webview panel.
3. A panel calls `ApiClient.get(path)` / `post(path, body)` and rebuilds its HTML
   from the response; failures are shown in place, not retried.
4. Webviews receive HTML built from a server response, with a nonce-based CSP.

## Token handling

`resolveTokenPath()` prefers `mind.tokenPath`, else
`~/.config/kIiYOSJe/mind/token`. The token is read per request from disk, never
cached in settings or logs. `mind.serverUrl` is validated as loopback before any
request is made.

## Error handling

- HTTP 423 (paused) shows the kill-switch explanation, not a generic failure.
- Network errors say the server is unreachable and how to start it.
- 401 says the token file is missing or stale and names the path.
- No retry loops: a failed action leaves state on screen for the operator.

## UI constraints

- No badge counts and no counters on the sidebar tree; no notification API
  calls. One status-bar item reports request activity (spinning, up to date,
  failed) while the operator is driving the UI — activity, not an amount.
- A screen the operator opens deliberately is compatible with absence: Analytics
  can plot numbers because nothing appears until it is opened.
- The sidebar is links only; lists and detail live in the webview panels.
- Every command title is `mind: <verb> <object>`.
- Webviews contain no remote assets, so the extension works offline.

## Testing strategy

- Server routes backing each view are covered by `app.test.ts` with an in-memory
  database.
- Pure models (`coverage-model`, `preview-model`, `flow-model`, `queue-view`,
  `nav-items`) are unit-tested in `extension/test/`.
- The extension itself is compiled but not yet interactively verified; the
  webview/tree click paths are the known gap and are recorded in `STATUS.md`.
