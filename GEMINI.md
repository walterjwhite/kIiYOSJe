# Context for Gemini CLI

`mind` is a local, single-operator attention manager (TypeScript, Node 24, ESM,
npm workspaces, SQLite, Hono, VS Code extension). The rules for any AI agent are
in AGENTS.md, imported here:

@./AGENTS.md

Policy and requirements live in `.kiro/steering/` and `.kiro/specs/`. Read the
files that match the task:

- Always: `workflow.md`, `security.md`, `product.md`, `licensing.md`
- Code: `tech.md`, `structure.md`, `code-style.md`, `testing.md`
- Data or logs: `privacy-data.md`, `observability.md`
- Models or prompts: `ai-quality.md`
- Speed or storage: `performance.md`

Commands: `npm run lint`, `npm run test:coverage`, `npm run license:check`,
`node scripts/check-secrets.mjs`. Format only files you touched
(`npx biome format --write <file>`); never run a whole-tree format.

In the GitHub workflow you cannot run `git commit`, `git push`, or `gh`. Leave
your changes in the working tree; the workflow opens the pull request.
