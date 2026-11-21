---

## inclusion: auto

# Tech

## Runtime and language

- Node.js ≥ 24, ESM only (`"type": "module"`), npm workspaces.
- TypeScript 7 strict, project references (`tsc --build`). No `any` in source;
  `unknown` plus zod parsing at every boundary.
- `skipLibCheck: true` is set globally because `drizzle-orm@0.45.4` declarations
  fail under TS 7. Remove it only when Drizzle ships a fix.

## Stack

| Concern    | Choice                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| HTTP       | `hono` + `@hono/node-server`, bound to `127.0.0.1`                                                                  |
| DB         | `better-sqlite3` + `drizzle-orm`, plain SQL migrations                                                              |
| Validation | `zod` — one schema for config, HTTP, and LLM structured output                                                      |
| LLM        | Vercel AI SDK (`ai`, `@ai-sdk/*`), plus ACP over stdio for `kiro-cli`/`copilot`                                     |
| Logging    | `pino` (JSON; redact paths in `logger.ts` censor tokens, keys, cookies, and auth headers; never log message bodies) |
| Tests      | `vitest`, headless                                                                                                  |
| UI         | VS Code extension: tree views + webviews, no framework                                                              |

## Conventions

- Dependency versions are pinned exactly for runtime deps; ranges only where a
  patch release is safe (`yaml`, `zod`).
- Never add a dependency for something the Node standard library already does.
- Prefer pure functions in `@mind/core` and `@mind/pipeline`; side effects belong
  in adapters, the server, or the extension.
- Every business decision writes one `actions` row and one `events` row,
  including "did nothing and why".
- Timestamps are ISO-8601 UTC strings in SQLite.
- Config and credentials live under `~/.config/kIiYOSJe/mind/` (mode 600) and are
  re-read on mtime change; they are never committed and never bundled.
- Secrets come from the environment first, then `credentials.yml`. Do not add
  new secret literals, fixtures with real tokens, or committed config.

## Commands

```bash
npm run dev      # build + start the server with --watch
npm test         # vitest run
npm run test:coverage   # vitest with v8 coverage and floors
npm run lint     # tsc --build, then Biome on files changed vs origin/main
npm run lint:all # Biome lint rules over the whole tree
npm run format   # Biome formatter
npm run license:check   # offline license audit of the lockfile
sh scripts/build-server.sh
bash scripts/build-extension.sh
```
