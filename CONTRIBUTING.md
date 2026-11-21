# Contributing

Thanks for helping. Humans and AI agents follow the same process, described in
full in `.kiro/steering/workflow.md`.

## Setup

```bash
nvm use            # Node 24, see .nvmrc
npm ci
npm run lint       # typecheck, then Biome on files changed vs origin/main
npm test
npm run test:coverage
npm run format     # Biome formatter
npm run license:check
```

## Process

1. Find or open an issue using a template. For a vulnerability, see `SECURITY.md`.
2. A maintainer triages it. Work starts when the issue has acceptance criteria.
3. Branch from `main`: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`.
4. Write a failing test, then the change. Keep the PR to one purpose.
5. Open a PR using the template, with `Closes #<n>`.
6. CI, security checks, and a maintainer review must pass. Merges are squash merges.

## Rules that are not negotiable

- Dependencies must pass `npm run license:check` (BSD-3-Clause compatible).
- No secrets, real message content, or real personal data anywhere in the tree.
- Do not weaken a send gate, authentication, or a safety test.
- Do not edit an applied migration; add a new one.
- Use only official, user-authorized provider APIs.

## Commit messages

Conventional Commits, for example `fix: compare token in constant time`.

## License

By contributing you agree your work is released under the BSD-3-Clause license in
`LICENSE`.
