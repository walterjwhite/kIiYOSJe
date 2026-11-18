# mind

A local attention manager: it ingests signals from your accounts, matches
them against Directions you write, drafts or sends replies, and surfaces
only what needs your judgement. See [PLAN.md](PLAN.md) for the design,
[STATUS.md](STATUS.md) for what's actually implemented and verified,
[DIRECTION.md](DIRECTION.md) for what the project is betting on,
[LIVE.md](LIVE.md) for running it against your own accounts, and
[references.md](references.md) for prior art and where each idea came from.

Everything runs on your machine. The server is the one source of truth;
the VS Code extension is the only client right now.

## Requirements

- Node.js ≥ 24
- [Ollama](https://ollama.com) running locally (default AI provider, free,
  no API key) — or an OpenAI/Anthropic/Google/Copilot API key, any
  OpenAI-compatible endpoint, or the Kiro/Copilot CLI over ACP

Sources are optional and additive: Gmail, Outlook, Google Calendar, GitHub pull
requests, and SMS via a self-hosted Google Messages bridge. Each one
stays idle until its credentials exist, and each can hold several accounts
belonging to the same person — a signal records which account it came from,
and a reply leaves from that account. [LIVE.md](LIVE.md) has the setup
and the order to add them in.

## 1. Install and build

```bash
sh scripts/build-server.sh
```

## 2. Start the server

```bash
npm run dev
```

This builds `packages/server` and starts it on `http://127.0.0.1:8787`,
running a database migration if needed and generating an API token at
`~/.config/kIiYOSJe/mind/token` on first run. Leave it running in a terminal.

Directions (the rules it matches signals against) live in `directions/*.yaml`.
Edit the example at `directions/work/boss.yaml` or add your own — the server
picks up changes without a restart.

By default nothing is sent anywhere: drafts wait in the review queue until
you approve them. Autonomous sending is off until you explicitly opt in
(see PLAN.md §7).

## 3. Install the VS Code extension

```bash
bash scripts/build-extension.sh
code --install-extension extension/mind-vscode-0.0.1.vsix
```

Reload VS Code. A **mind** icon appears in the Activity Bar (the far-left
icon rail). Its sidebar is deliberately thin — one link per section, no
live data sitting in view until you open one. The extension talks to the
server at `http://127.0.0.1:8787` using the token from
`~/.config/kIiYOSJe/mind/token` — no extra setup needed as long as the
server from step 2 is running.

## 4. Use it

Click the **mind** icon in the Activity Bar, then click a section to open
it as its own panel:

- **Queue** — drafted replies awaiting approval; approve or discard each
  one inline. This is the only place a send is authorized.
- **Today** — the daily brief: what needs you, what's running, what's overdue.
- **Signals** — every signal, inbound and outbound; defaults to today, with
  a range control to widen it. Reclassify a signal from here if it matched
  the wrong Direction.
- **Directions** — the table of rules mind matches signals against; click
  a row to edit its standard, match/response prompts, and confidence.
  New Directions are still authored as YAML (**mind: Edit Directions**).
- **Learnings** — policy narrow/widen proposals the learning loop generates
  from override history, plus the reclassification log.
- **Analytics** — volume, override rate, and time saved; click a row or
  bar to see the signals behind it.
- **Journal** — a read-only audit log of everything the system did.
- **Devices** — placeholder; device pairing isn't built yet.

Commands (Cmd/Ctrl+Shift+P, type `mind:`):

- **mind: Capture Thought** — jot something down without opening a panel.
- **mind: Configure AI Provider** — switch between Ollama, a cloud or
  OpenAI-compatible endpoint, or the Kiro/Copilot CLI over ACP; change models.
- **mind: Configure Notification Quiet Period** — restrict when the
  system may proactively notify you (default Mon–Fri 08:00–15:00). This
  doesn't affect asking it for something right now.
- **mind: Pause Sends** / **Resume Sends** — kill switch for all outbound
  sends.

There is also a small CLI, built with the rest of the workspace:

```bash
node packages/cli/dist/index.js doctor                # what is configured, what is missing
node packages/cli/dist/index.js coverage              # absorb rate per week against coverage
node packages/cli/dist/index.js preview <directionId> # dry-run a Direction; writes nothing
node packages/cli/dist/index.js explain <signalId>    # why one decision happened
```

## Demo data

To try it without connecting real accounts:

```bash
npm run demo:seed     # generates synthetic signals and runs them through the real pipeline
npm run demo:serve    # starts the server against the demo database
npm run demo:summary  # prints what happened
npm run demo:reset    # wipes the demo database
```

See `packages/demo-data/README.md` for details.

## Configuration

Everything lives under `~/.config/kIiYOSJe/mind` (mode 600) and
`~/.data/kIiYOSJe/mind`. `MIND_CONFIG_DIR` and `MIND_DATA_DIR` relocate those
directories; `MIND_DB_PATH` relocates the database alone, which is how
`demo:serve` points the server at `demo.db`.

- `config/ai.json` — provider, models, base URL, API key
- `config/credentials.yml` — Google, Outlook, GitHub, and Google Messages
  bridge credentials, one or more accounts per source (mode 600, never
  committed)
- `config/notifications.json` — notification quiet period
- `config/token` — API bearer token
- `config/paused` — send kill-switch flag
- `data/mind.db` — database; `data/demo.db` — demo database
- `data/backups/`, `data/snapshots/` — rotating copies and named archives

Environment overrides: `MIND_AI_PROVIDER`, `MIND_AI_API_KEY`, `MIND_AI_BASE_URL`,
`MIND_CLASSIFY_MODEL`, `MIND_DRAFT_MODEL`, `MIND_RETENTION_DAYS`,
`MIND_SEND_ENABLED`, `MIND_LOG_LEVEL`, `MIND_DIRECTIONS_DIR`, `MIND_DB_PATH`,
`MIND_CONFIG_DIR`, `MIND_DATA_DIR`, `MIND_TEST_TOKEN`.

## Behind a proxy

If outbound traffic goes through an HTTP/HTTPS proxy (`http_proxy`/
`https_proxy` set in the environment), two things need to line up:

- **The server** needs `NODE_USE_ENV_PROXY=1` so Node's `fetch` (used by the
  Gmail/Outlook/GitHub adapters and every cloud AI provider) actually routes
  through the proxy — Node does not read `http_proxy`/`https_proxy` on its
  own. Set `no_proxy=localhost,127.0.0.1` alongside it so local-only traffic
  (Ollama on `127.0.0.1:11434`) bypasses the proxy instead of being tunneled
  through it, which most proxies refuse for loopback addresses:

  ```bash
  NODE_USE_ENV_PROXY=1 no_proxy=localhost,127.0.0.1 npm run dev
  ```

- **VS Code** applies the same proxy to extension traffic by default,
  including the extension's calls to the server at `127.0.0.1:8787` — which
  the proxy will also reject. Add a bypass in VS Code's `settings.json`:

  ```json
  "http.noProxy": ["localhost", "127.0.0.1"]
  ```

  Without it, the extension reports "Can't reach the mind server" even
  though the server is running and `curl --noproxy "*" http://127.0.0.1:8787/health`
  succeeds from a terminal.

## API

`GET /health`, `GET /brief`, `GET|POST /thoughts`, `PATCH /thoughts/:id`,
`GET /directions`, `PUT /directions/:id`, `GET /actions`, `PATCH /actions/:id`,
`POST /actions/:id/send`, `POST /actions/:id/discard`, `POST /signals`,
`GET /signals`, `PATCH /signals/:id`, `GET /signals/:id/explain`,
`POST /signals/:id/undo`, `POST /directions/preview`, `GET /metrics`,
`GET /metrics/signals`, `GET /metrics/coverage`,
`GET /proposals`, `POST /proposals/run`, `POST /admin/pause`,
`POST /admin/resume`, `GET /admin/status`, `GET /admin/ai-config`,
`PUT /admin/ai-config`, `GET /admin/notifications`,
`PUT /admin/notifications`, `GET /events`.

`POST /signals` returns the full ingest result — `disposition`, `signalId`,
`thoughtId`, `actionId`, and `reason` — so a caller can follow the ids without
re-querying by adapter and external id.

## Tests

```bash
npm test
```

## License

BSD-3-Clause. See [LICENSE](LICENSE).

## Trademarks

Product names used here — including Gmail, Google Calendar, Google Messages,
Microsoft Outlook, GitHub, Jira, Confluence, VS Code, Kiro, and
Copilot — are trademarks of their respective owners. They are used only to
describe interoperability with those products. This project is not affiliated
with, endorsed by, or sponsored by any of them.
