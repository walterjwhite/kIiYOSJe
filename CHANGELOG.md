# Changelog

All notable changes are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (breaking changes may occur in minor
versions while the project is `0.x`).

## [Unreleased]

### Changed

- `scripts/build-extension.sh` installs the built extension with the `code`
  CLI, so rebuilding no longer needs a separate install step. Pass
  `--no-install` to package only; install is skipped in CI and when `code` is
  not on PATH.
- `scripts/build-server.sh` now (re)starts the server after building it: a
  running instance is stopped through `POST /admin/shutdown` first, then the
  new build runs in the background (`server.log` and `server.pid` under the
  mind data directory). Pass `--no-restart` to build only.
- Sidebar: links show only their name. The grey text after each one ("goals, and
  what needs action" and the rest) is gone.
- Sidebar: a link takes an accent color (background, left edge and icon) on hover
  and keyboard focus, and none at rest. This needed the sidebar to become a
  webview in place of a tree view, because VS Code does not let an extension
  style tree rows. Up and Down move between links, and the Developer group is
  still collapsed by default.
- Queue: goal cards are clean. There is no "N linked" badge and no **Rename**,
  **+ Sub-goal**, **Done** or **Park** button. Double-click a goal name to rename
  it in place, drag a goal onto another goal to make it a sub-goal (or onto the
  **Goals** heading for top level), and use the one **Show linked** button above
  the goals to show or hide linked records for every goal. Linked records are
  hidden by default. The two columns use the full panel width.
- Clicking a goal opens its details: an editable name and a **Signals** tab with
  every signal linked to it. `GET /signals` accepts `thoughtId`, and
  `PATCH /thoughts/:id` accepts `title` and `parentId` (the parent must be an open
  goal and cannot be the goal itself or one of its descendants).
- Queue: a **Goals in both columns** switch swaps the signal list for a second
  list of goals, so linked records can be dragged from one goal to another. The
  left column shows each goal with its records, the right column shows the goals
  alone as drop targets. Ctrl/Cmd+click and Shift+click select several records
  across goals, and a drag carries the whole selection. The default is goals on
  the left and signals on the right.
- Devices: double-click a device name to rename it in place, or its permissions
  to show a toggle for each (`PATCH /devices/:id` accepts `name` and `scopes`;
  the change applies on the device's next request). The **Paired** column now
  shows the same relative time as **Last seen**, with the full timestamp on hover.
- Devices: **+ Add new Device** opens the pairing form and shows the code at once,
  with a countdown bar. The code is replaced when it runs out or when the name or
  permissions change, and the form closes when a device pairs.
  `DELETE /devices/pairing/:id` withdraws a pending code so a replaced code stops
  working.
- Devices: the explanatory paragraph above the table moved to `USAGE.md`.
- Queue: each column keeps its scroll position when a record is moved, instead of
  jumping to the top.

### Fixed

- The learning loop no longer stores the same suggestion every run. A suggestion
  is skipped while an identical one is pending, and for 30 days after it was
  accepted or rejected.
- Learnings view: suggestions read as sentences ("Be pickier about work/boss.
  Minimum confidence 70% → 75%.") with the reason, the counts, and what Accept
  does, in place of field names and raw values. It states when the loop runs and
  last ran, lists pending suggestions before answered ones, and labels the model's
  text as commentary.


- The demo server could poll configured mail and calendar accounts into
  `demo.db`, mixing real messages with the synthetic personas. `npm run
  demo:serve` now sets `MIND_ADAPTERS=none`, and the server registers no live
  adapter whenever `MIND_DB_PATH` names `demo.db`.
- `GET /signals?range=all` returned only today's signals, so **All** on the
  Signals screen showed the same as **Today**.
- Devices: the permission checkboxes in the pairing form are now the same toggle
  switches the rest of the app uses.

### Added

- Learnings files: write short notes in `learnings/*.md` (title, `applies`,
  `direction`, `enabled`) and mind adds them to the classifier and drafter
  prompts. Edit and commit them like Directions. They cannot allow a send. With no
  files, prompts are unchanged. Each `signal.processed` event lists the learning
  ids used (ids only). `GET /learnings` lists them and the files that were
  skipped. See `learnings/README.md`. Learnings go to the configured model
  provider with the prompt. Implemented and unit-tested; not evaluated with a
  live model.
- The learning loop runs once a night, 00:00 to 04:00 local time by default.
  Change the window in Settings (Learning loop) or `learning.json`
  (`GET`/`PUT /admin/learning`). `GET /proposals/schedule` returns the window
  and the last run. A manual run does not use up the night's run.


- Device pairing. **Devices** in the extension is a real registry: choose a
  name and scopes, show a six-digit code, and the new client exchanges it for
  its own token. Tokens and codes are stored hashed, codes expire in ten
  minutes and are single-use, each request checks the device's scopes, and
  revoking one device takes effect on its next request without touching the
  others. `POST /devices/pairing`, `POST /devices/pair`, `GET /devices`,
  `DELETE /devices/:id`. Migration `0014_devices`.
- Pairing is a scan. The Devices panel shows a QR code that carries the server
  address _and_ the six-digit code, and the Android app's **Scan pairing QR
  code** fills in both fields (they stay editable, and typing still works). The
  encoder is in `extension/src/qr.ts`, so the extension keeps no runtime
  dependencies. `mind.pairingServerUrl` chooses the encoded address; the
  default is this machine's private IPv4 address, since `mind.serverUrl` is
  normally loopback.
- `android/deploy-debug.sh --local` forwards `tcp:8787` to the phone with
  `adb reverse`, so the phone can pair to `http://127.0.0.1:8787` without the
  server binding to the network. `MIND_PORT` changes the port.
- An Android client in [`android/`](android/README.md): pair once, then read the
  Queue, capture a thought, acknowledge a signal, and approve or discard a draft
  when the device was granted `send`. The last queue is cached and labelled as
  cached when the server is unreachable. CI runs Android lint, the unit tests
  and the debug build on every pull request — lint treats warnings as errors —
  uploading the APK as an artifact, and
  `android/deploy-debug.sh` builds, installs and launches it on a connected
  phone.
- `MIND_BIND_HOST` lets the server bind beyond loopback so a phone on a private
  network can reach it. The default is still `127.0.0.1`, and every route still
  requires a token.
- Analytics opens with the coverage curve: weekly absorb rate against the number
  of Directions in force, explicit Directions only, with the 60% target marked
  and signals absorbed but never answered drawn beside it. Click a week to list
  its signals (`GET /metrics/signals` gains `week=YYYY-MM-DD`).
- Directions detail has **Preview** dry runs: `POST /directions/preview` over
  stored signals, optionally with the classifier on up to ten matches, showing
  what would match, what fell through to the catch-all and what would trip a
  guard without changing anything.
- Auto-link shortlists the three best-matching goals (BM25 over title, parent title, notes and hand-linked subjects, with sender and thread affinity) instead of sending up to 25 goals to the model, and shows each candidate's hand-linked subjects as examples. A message that resembles no goal skips the model call. Automatic link events record `promptVersion` and `candidateIds`. `GET /metrics` gains `autoLink` with the share of automatic links later undone.
- Model Trace shows where signals went: green boxes under the model for Queue, Absorbed, Filed and each linked goal (top three, then "N other goals"). Clicking one lists its signals, and the signal table has a "Went to" column.
- Sub-goals. **+ Sub-goal** on a goal adds a goal under it, to any depth; items can be dragged or linked to a sub-goal as to any goal. `POST /thoughts` accepts `parentId` (an existing goal). Migration `0013_goal_parent` adds `thoughts.parent_id`.
- The Queue has a **Filter signals** box that matches every word against all text an item shows.

### Fixed

- A message larger than the model's context window no longer fails with "exceeds the available context size". Message text is condensed and cut to fit before every model call, with one retry at half size. Set the window with `contextTokens` in `ai.json`.

### Changed

- The sidebar groups System Events and Model Trace under a collapsed
  **Developer** section, keeping the default path to the operator's screens.
  Analytics is described by what it measures — absorb rate against Directions —
  instead of "time saved", which was never rendered.
- Model Trace boxes no longer overlap: steps are evenly spaced, the "Queue / absorb" step is gone (outcomes are drawn after the model instead), and model boxes widen to fit their text.
- The Queue's Goals and signals columns scroll independently.
- Analytics replaces the "By channel" bars with a flow diagram (channel, Direction, outcome) whose nodes and lines list their signals when clicked.

- Form controls follow the editor theme instead of the browser's light default.
- Queue items can be multi-selected (Ctrl/Cmd+click, Shift+click) and planned, linked or dragged together.
- Model Trace lists the records behind any clicked node or line, with sender and subject, and opens the signal on click.
- On-screen instructions removed throughout the extension; they now live in USAGE.md.

### Removed

- The nav tree's error badge. One status-bar item still reports request
  activity, without a count.
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
