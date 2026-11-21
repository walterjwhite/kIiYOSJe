---

inclusion: fileMatch
fileMatchPattern: "**/*.ts"
---

# Code style

Follow `tech.md` and `structure.md` first. This file covers the rest.

## TypeScript

- Strict mode, ESM, no `any`. Use `unknown` and parse with zod at boundaries.
- Prefer `type` imports, `readonly` data, discriminated unions, and exhaustive
  `switch` with a `never` check.
- Pure functions in `@mind/core` and `@mind/pipeline`; effects in adapters,
  server, and extension. Pass dependencies in (db, clock, ids, fetch); do not
  reach for globals.
- No floating promises. Every `await` of external I/O has a timeout or abort signal.
- No default exports. One concept per file; keep files small enough to read in one go.
- Names say what a thing is. No abbreviations the domain does not use.
  Domain terms: Signal, Thought, Direction, posture, gate, adapter.
- Comments explain why, not what. Link a spec or issue for non-obvious decisions.

## Errors

- Expected failures are values or typed errors with a stable `code`; unexpected
  ones throw. Wrap provider errors once, at the adapter edge.
- HTTP errors go through `errors.ts`; responses never include stack traces,
  content, or secrets.
- A failing adapter or model call must not take the process or other adapters down.

## Formatting and linting

Biome does both (`biome.json`). Prettier and ESLint are not used: `typescript-eslint`
needs the TypeScript JavaScript API, which TypeScript 7 does not ship.

- `npm run lint`: `tsc --build`, then Biome (lint, format, import order) on files
  changed since `origin/main`. CI runs the same command.
- `npm run lint:all`: lint rules over the whole tree, errors only.
- `npm run format`: apply the formatter. `npm run format:check`: verify only.
- Rules that fail the build: `noExplicitAny`, `noUnusedImports`,
  `noUnusedVariables`, `useImportType`, `noFloatingPromises`, `noMisusedPromises`.
  `extension/src` warns on floating promises until the debt issue is closed.
- Fix what Biome reports in files you touch. Do not silence a rule with an ignore
  comment unless you explain why on the same line.
- `.editorconfig` sets indentation and final newlines.

## Git

- Branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`; agents use
  `agent/<issue>-<slug>`.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`,
  `ci:`, `perf:`, `refactor:`), imperative, under 72 chars on the first line,
  body explains why. Reference the issue.
- Commit as work happens. Do not squash local history before opening a PR, and do
  not rewrite published history. Merges to `main` are squash merges through a PR.
- Never commit `dist/`, `.vsix`, databases, or anything matched by `.gitignore`.

## Pull requests

Small, one purpose, linked issue, tests, updated docs and specs. See the PR template.
