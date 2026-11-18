---
inclusion: auto
---

# Structure

```
packages/core       schema, config, credentials, logger, typed HTTP helpers
packages/pipeline   dedupe → normalize → match → classify → decide → record
packages/adapters   gmail, outlook (Graph), gmessages (Matrix), calendar
packages/server     Hono app, routes, auth, startup
packages/cli        `mind` client for the local API
packages/demo-data  synthetic personas replayed through the real pipeline
extension           VS Code client: Queue, Thoughts, Signals, Journal, webviews
directions          operator-authored YAML (source of truth), hot-reloaded
mockup              standalone HTML/JS design prototype, no build step
```

## Layering rules

- The pipeline is the only place decisions happen. Adapters never decide, the API
  never decides, the extension never decides.
- Adapters implement one contract (`start`/`stop`/optional `send`) and are
  in-process modules. A broken source logs "not configured" and returns; it must
  never take the other sources down.
- The server is the single source of truth. The extension holds no private copy
  of shared state.
- `directions/*.yaml` is authoritative over the `directions` table. Accepting a
  learning-loop proposal returns the YAML edit to make by hand, because a reload
  would revert a DB-only change.
- One adapter per file group under `packages/adapters/src/<source>/`; mapping is
  pure and unit-tested, network access stays in `client.ts`/`adapter.ts`.
- Migrations live in `packages/core/migrations`; never edit an applied migration,
  add a new one.

## Extension rules

- Commands are prefixed `mind.`; every user-visible string says what it does.
- Webviews set a strict CSP with a per-render nonce and no remote resources.
- The token is read from `~/.config/kIiYOSJe/mind/token`; the extension never
  asks for or stores provider credentials itself.
