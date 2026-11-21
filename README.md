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

- Optional: [Piper](https://github.com/OHF-Voices/piper1-gpl) for the spoken
  daily summary (`pip install piper-tts`). Without it everything else works and
  the Audio button explains what is missing. See
  [Audio summary](#audio-summary-piper).

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
it as its own panel. [USAGE.md](USAGE.md) explains each one; the screens
themselves carry no instructions.

- **Queue** — two columns. Left: your **Goals** (Thoughts you are focusing
  on); drag an item onto one to link it, and new items are linked
  automatically when the model is confident enough (Settings). Right:
  everything awaiting action that is not linked to a goal. The **Transcript**
  and **Audio** buttons give the day's summary as text and as speech
  (rendered locally with Piper). Items are drafted replies and surfaced
  signals nobody has acknowledged. Each item says when it needs you and why
  (some can wait), and offers the actions that fit it. Drag to reorder;
  **Details** opens the conversation, thought, and history. Approving a
  drafted reply here is the only place a send is authorized.
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
- **Journal** — your own dated notes.
- **System Events** — what mind itself did, in order. Click a column header
  to sort; the Detail column is a highlighted one-line preview of the event's
  JSON that expands to the full payload.
- **Model Trace** — an interactive graph of every model call and where it went.
- **Devices** — placeholder; device pairing isn't built yet.
- **Settings** — which signal fields are shown, automatic goal linking (on or
  off, and the minimum confidence), and the audio summary's voice, speed,
  tone and Piper command.

Each screen is explained in [USAGE.md](USAGE.md): goals, multi-select, the
transcript and audio, auto-linking, and how to read Model Trace.

## Audio summary (Piper)

The Queue's **Transcript** button shows the day's summary as text: your goals
and what is linked to each, how many items are waiting and how urgent, the
most pressing ones, and how many messages were handled without reaching you.
**Audio** reads exactly that text aloud. The audio is rendered on your machine
by [Piper](https://github.com/OHF-Voices/piper1-gpl), a separate program you
install; mind runs it as a child process, sends the text on stdin, and keeps
the result as a WAV under `data/audio/`. Nothing is uploaded.

Setup:

```bash
pip install piper-tts      # or any install that gives you a `piper` command
```

Then open **Settings → Audio summary**:

| Setting | What it does |
| --- | --- |
| Voice | A Piper voice name such as `en_US-lessac-medium` (language_REGION-name-quality). Samples: <https://rhasspy.github.io/piper-samples/>. Gender and accent are properties of the voice. |
| Speed | 0.5 to 2. 1 is the voice's natural pace. |
| Tone | `calm`, `neutral` or `upbeat`. Changes the greeting and how varied Piper's delivery is. |
| Speaker number | Only for multi-speaker voices. |
| Piper command | Default `python3 -m piper`. Split on spaces and run without a shell, so use `piper` if that is on your PATH. |
| Download voices | When on, a voice that is not in `data/voices/` is downloaded once from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) on huggingface.co. |

That download is the only network use audio adds, and it is off if you turn
the setting off; then put the voice's `.onnx` and `.onnx.json` files in
`data/voices/` yourself. Each voice has its own license on its model card,
so read it before using a voice. If Piper is missing or exits with an error,
the Audio button shows the reason. The rendered audio is re-made when the
summary text changes.

Piper's license is GPL-3.0. mind does not include, link or copy any Piper code;
it only runs the program you installed (see [references.md](references.md) §5).

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
- `config/display.json` — which signal fields the extension shows
- `config/autolink.json` — automatic goal linking: `enabled`, `threshold`
- `config/audio.json` — voice, speed, tone, speaker, Piper command, voice download
- `config/token` — API bearer token
- `config/paused` — send kill-switch flag
- `data/mind.db` — database; `data/demo.db` — demo database
- `data/backups/`, `data/snapshots/` — rotating copies and named archives
- `data/voices/` — downloaded Piper voices; `data/audio/` — the rendered
  summary (`summary.wav`) and the text it was made from

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
`PUT /admin/notifications`, `GET /events`, `GET /queue`, `PUT /queue/order`,
`PUT /queue/plan`, `GET /queue/:id`, `PUT|DELETE /signals/:id/thought`
(link a signal to a thought or goal, or unlink it),
`GET|PUT /admin/display`, `GET|PUT /admin/autolink`, `GET|PUT /admin/audio`,
`GET /summary` (the transcript), `POST /summary/audio` (render it with Piper),
`GET /summary/audio` (the WAV). `POST /thoughts` accepts `"state": "goal"` to
create a goal.

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
