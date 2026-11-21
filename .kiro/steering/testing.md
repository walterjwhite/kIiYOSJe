---
inclusion: fileMatch
fileMatchPattern: "**/*.test.ts"
---

# Testing

## Principles

- A change is done when a test fails without it and passes with it. A bug fix
  starts with a failing regression test.
- Tests are headless, offline, deterministic, and fast. No real network, no real
  model, no real clock, no real home directory.
- Test behavior at the public seam of a module. Avoid asserting on private
  structure that a refactor would break.

## Layers

| Layer | What | Where |
| --- | --- | --- |
| Unit | pure functions: match, normalize, dedupe, mapping, config parsing | `*.test.ts` beside source |
| Contract | every adapter satisfies `start`/`stop`/optional `send` and degrades to "not configured" | `packages/adapters` |
| Pipeline | ingest end to end with a stub model and in-memory SQLite | `packages/pipeline` |
| Safety | send gates, pause flag, empty draft, injection corpus | `decide.test.ts`, `autosend.test.ts`, `guards.test.ts` |
| API | routes through `buildApp` with `MIND_TEST_TOKEN` | `packages/server` |
| Migration | empty and populated upgrade, idempotent re-run | `packages/core` |
| Eval | labelled signals, stub model in CI, live model manual | `packages/pipeline/eval` |
| Extension | command wiring, CSP, escaping | `extension/test` |

## Rules

- Use temp dirs and set `MIND_CONFIG_DIR`, `MIND_DATA_DIR`, `MIND_DB_PATH`;
  restore the environment in `afterEach`.
- Inject the clock (`clock.ts`) and ids (`id.ts`); never sleep to wait.
- Fakes over mocks for adapters and the model. A fake model returns structured
  output that can also be hostile.
- **Safety tests are never skipped, loosened, or deleted** to make a build pass.
  A failing safety test means the code is wrong.
- Fixtures contain synthetic people and fake credentials only.
- Property-style tests for parsers and normalizers where input is open-ended
  (quote stripping, dedupe keys, deadline grounding).
- Flaky test: fix or quarantine in a labelled issue within a day. No retry loops.

## Gates

`npm run lint`, `npm run test:coverage`, `npm run license:check`,
`node scripts/check-secrets.mjs` and `node scripts/check-migrations.mjs` must pass
locally and in CI. Coverage floors live in `vitest.config.ts` (about two points
under the measured baseline); raise them as coverage improves and never lower one
to make a change pass. `decide.ts` and `auth.ts` need full branch coverage
(tracked in an issue; both are below it today).
