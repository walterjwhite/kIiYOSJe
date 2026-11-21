# Design — review queue extension

## Shape

A dedicated Activity Bar container (`mind`) with four tree views and three
webviews. Everything is driven by `ApiClient`, a thin typed wrapper over the local
HTTP API with the bearer token attached.

```
extension/
  src/extension.ts          activation, command registration, refresh
  src/api-client.ts         fetch wrapper, token read, error mapping
  src/review-provider.ts    Queue tree (approve/discard inline)
  src/thoughts-provider.ts  Thoughts tree
  src/signals-provider.ts   Signals tree + range + reclassify
  src/journal-provider.ts   Journal tree (read-only)
  src/queue-panel.ts        Queue: goals column, unlinked column, summary strip
  src/goals.ts              pure goal helpers (flags, sorting, sub-goal tree, splitting items)
  src/queue-search.ts       the lower-case text of a Queue item that the signal filter matches
  src/model-trace-panel.ts  Model Trace graph (data from signal.processed events)
  src/trace-model.ts        pure aggregation behind the graph
  src/json-html.ts          pure JSON highlighter used by System Events and others
  src/analytics-panel.ts    drill-down webview
  src/devices-panel.ts      placeholder webview
  src/ai-config.ts          provider QuickPick + settings write
  src/notifications-config.ts  quiet-period QuickPick flow
```

## Data flow

1. Activation registers commands and creates the tree providers.
2. A provider calls `ApiClient.get(path)` and maps rows to `TreeItem`s; item
   `contextValue` drives which inline actions the menus show.
3. A command performs one HTTP call, shows an error message on failure, then
   refreshes the affected providers.
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

- No badge counts, no status-bar counter, no notification API calls.
- Native tree views over webviews wherever a list is enough.
- Every command title is `mind: <verb> <object>`.
- Webviews contain no remote assets, so the extension works offline.

## Testing strategy

- Server routes backing each view are covered by `app.test.ts` with an in-memory
  database.
- The extension itself is compiled but not yet interactively verified; the
  webview/tree click paths are the known gap and are recorded in `STATUS.md`.
