# mind

A local attention manager: it ingests signals from your accounts, matches
them against Directions you write, drafts or sends replies, and surfaces
only what needs your judgement. See [PLAN.md](PLAN.md) for the design and
[STATUS.md](STATUS.md) for what's actually implemented and verified.

Everything runs on your machine. The server is the one source of truth;
the VS Code extension is the only client right now.

## Requirements

- Node.js ≥ 24
- [Ollama](https://ollama.com) running locally (default AI provider, free,
  no API key) — or an OpenAI/Anthropic/Google API key if you'd rather use
  a cloud provider

## 1. Install and build

```bash
sh build-server.sh
```

## 2. Start the server

```bash
npm run dev
```

This builds `packages/server` and starts it on `http://127.0.0.1:8787`,
running a database migration if needed and generating an API token at
`~/.config/mind/token` on first run. Leave it running in a terminal.

Directions (the rules it matches signals against) live in `directions/*.yaml`.
Edit the example at `directions/work/boss.yaml` or add your own — the server
picks up changes without a restart.

By default nothing is sent anywhere: drafts wait in the review queue until
you approve them. Autonomous sending is off until you explicitly opt in
(see PLAN.md §7).

## 3. Install the VS Code extension

```bash
bash build-extension.sh
code --install-extension extension/mind-vscode-0.0.1.vsix
```

Reload VS Code. A **mind** icon appears in the Activity Bar (the far-left
icon rail) — click it to open the sidebar with Queue, Thoughts, Signals,
and Journal. The extension talks to the server at `http://127.0.0.1:8787`
using the token from `~/.config/mind/token` — no extra setup needed as
long as the server from step 2 is running.

## 4. Use it

Click the **mind** icon in the Activity Bar to open its sidebar:

- **Queue** — drafted replies awaiting approval; approve or discard each
  one inline. This is the only place a send is authorized.
- **Thoughts** — things that need a decision.
- **Signals** — every signal, inbound and outbound; defaults to today
  (**mind: Set Signals Range** to widen it). Right-click a signal to
  **Reclassify** it if it matched the wrong Direction.
- **Journal** — a read-only audit log of everything the system did.

Commands (Cmd/Ctrl+Shift+P, type `mind:`):

- **mind: Capture Thought** — jot something down.
- **mind: Open Today Brief** — a daily summary webview.
- **mind: Open Analytics** — volume and override rates; click a row or
  bar to see the signals behind it.
- **mind: Open Devices** — placeholder; device pairing isn't built yet.
- **mind: Edit Directions** — open a Direction's YAML file.
- **mind: Configure AI Provider** — switch between Ollama and a cloud
  provider, or change models.
- **mind: Configure Notification Quiet Period** — restrict when the
  system may proactively notify you (default Mon–Fri 08:00–15:00). This
  doesn't affect asking it for something right now.
- **mind: Pause Sends** / **Resume Sends** — kill switch for all outbound
  sends.

## Demo data

To try it without connecting real accounts:

```bash
npm run demo:seed     # generates synthetic signals and runs them through the real pipeline
npm run demo:serve    # starts the server against the demo database
npm run demo:summary  # prints what happened
npm run demo:reset    # wipes the demo database
```

See `packages/demo-data/README.md` for details.

## Tests

```bash
npm test
```
