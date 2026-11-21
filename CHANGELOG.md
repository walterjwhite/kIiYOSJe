# Changelog

All notable changes are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (breaking changes may occur in minor
versions while the project is `0.x`).

## [Unreleased]

### Added
- Model Trace shows where signals went: green boxes under the model for Queue, Absorbed, Filed and each linked goal (top three, then "N other goals"). Clicking one lists its signals, and the signal table has a "Went to" column.
- Sub-goals. **+ Sub-goal** on a goal adds a goal under it, to any depth; items can be dragged or linked to a sub-goal as to any goal. `POST /thoughts` accepts `parentId` (an existing goal). Migration `0013_goal_parent` adds `thoughts.parent_id`.
- The Queue has a **Filter signals** box that matches every word against all text an item shows.

### Fixed
- A message larger than the model's context window no longer fails with "exceeds the available context size". Message text is condensed and cut to fit before every model call, with one retry at half size. Set the window with `contextTokens` in `ai.json`.

### Changed
- Model Trace boxes no longer overlap: steps are evenly spaced, the "Queue / absorb" step is gone (outcomes are drawn after the model instead), and model boxes widen to fit their text.
- The Queue's Goals and signals columns scroll independently.
- Analytics replaces the "By channel" bars with a flow diagram (channel, Direction, outcome) whose nodes and lines list their signals when clicked.

- Form controls follow the editor theme instead of the browser's light default.
- Queue items can be multi-selected (Ctrl/Cmd+click, Shift+click) and planned, linked or dragged together.
- Model Trace lists the records behind any clicked node or line, with sender and subject, and opens the signal on click.
- On-screen instructions removed throughout the extension; they now live in USAGE.md.

### Removed

- The Today screen. Overdue and review-due goals, the absorbed count and the summary now live on the Queue. `GET /brief` is unchanged.

### Added

- Biome for lint, format, and import order (`npm run lint`, `lint:all`, `format`); Vitest coverage with floors (`npm run test:coverage`)
- Gemini agent: `gemini-agent.yml` (run-gemini-cli on GitHub-hosted runners) implements `ai-ready` issues and opens draft PRs; `GEMINI.md` carries the agent context
- Queue is two columns: Goals (Thoughts in the new `goal` state) on the left, items not linked to a goal on the right. Drag an item onto a goal to link it; Unlink undoes it. Items show one identity line and expand on click.
- Auto-link: new Queue items are linked to a Goal when the model's confidence meets a threshold (on by default, 0.8, in Settings). Recorded as `signal.thought_linked` with `auto: true`.
- Daily summary as a transcript and as audio (`GET /summary`, `POST|GET /summary/audio`), rendered locally by Piper. Voice, speed, tone and Piper command are in Settings. A missing voice is downloaded once from huggingface.co when `autoDownload` is on.
- Model Trace screen: interactive graph of every model call, with a check against a local Ollama.
- Sortable System Events columns and syntax-highlighted JSON.
- GitHub Actions for CI, security scanning, agent PR guard, agent issue intake, and releases
- Issue and PR templates, CODEOWNERS, Dependabot configuration
- Secret scan, migration immutability, and protected-path scripts
- Steering for security, testing, performance, observability, privacy, AI quality, release, code style, docs, and workflow
- Specs for safety and send gating, adapters and onboarding, learning loop metrics, operations, and the server API
