# @mind/demo-data

Fake signals, real decisions. Three personas worth of synthetic email
traffic, replayed through the real pipeline — dedupe, match, **classify
(a real model call)**, **draft (a real model call)**, decide, record, the
escalation checker, auto-disable, and the learning loop all run exactly as
they would in production. Nothing about how the system responds to a given
signal is scripted or looked up from a table. The only fake things are the
signal data itself and the outbound side effect (no email actually leaves
the machine).

This runs against a dedicated SQLite file at `~/.data/kIiYOSJe/mind/demo.db`.
It is never the real `mind.db`, and the demo never reads or writes real
directions outside `directions/demo/`.

## Requirements

An AI provider must be configured before seeding — otherwise `classify()`/
`draft()` fall back to a zero-confidence stub and every signal just
escalates, which proves nothing. The default provider is **ollama**, local
and free:

```bash
ollama serve                        # if not already running
ollama pull qwen2.5:3b-instruct      # ~2GB, first time only
```

No further configuration needed — `~/.config/kIiYOSJe/mind/ai.json` defaults to
`provider: ollama` pointed at `http://localhost:11434/v1`. To use a cloud
provider instead, run the **mind: Configure AI Provider** command in VS
Code, or write the file directly (see `packages/core/src/config.ts`).

Seeding calls a real model once per signal for classification and again for
any drafted reply — expect roughly 25–30 real model round-trips across all
three personas. On a 3B model running locally on a laptop CPU, that's on
the order of a few minutes, not seconds. This is the real cost of using a
real, probabilistic model instead of a script, and it's the thing being
demonstrated.

## Personas

| Persona                              | Directions it exercises                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Software Engineer** (`engineer`)   | Answerable technical questions, CI noise filed as evidence rather than replied to, a paging alert against an `escalateOn` guard.                                        |
| **Project Manager** (`pm`)           | Scheduling and status requests drafted for approval; a deliberately loosely-authored `vendor-noise` direction expected to accumulate overrides.                         |
| **DevSecOps Engineer** (`devsecops`) | A `posture: escalate` direction for genuine security incidents; `posture: absorb, autonomy: send` directions with `escalateOn` guards on dependency and scanner alerts. |

Each persona file (`src/personas/*.ts`) splits its signals into two eras:

- **historical** — replayed, then given a _simulated operator reaction_
  (see "How resolution works" below), so the system looks lived-in: real
  override rates per direction, maybe one already auto-disabled, maybe a
  pending learning-loop proposal — before you ever open the extension.
- **live** — replayed and left exactly as the model decided. These are the
  ones you act on. They show up as real proposed actions in the Review
  panel, or as Thoughts if the model escalated or surfaced them, or as
  sent actions if a `autonomy: send` direction's gates were all open.

Because classification is genuinely probabilistic, the exact mix of sent
vs. discarded vs. escalated outcomes will differ between seed runs, and
between model/provider choices. That's expected. The `intent` field on each
`ScenarioSignal` documents what the signal is _designed_ to exercise — not
a guarantee of what the model will decide.

## Usage

```bash
# from the workspace root
npm run demo:seed              # reset + seed all three personas (real model calls)
npm run demo:seed engineer     # seed only one persona
npm run demo:summary           # print the aggregate numbers
npm run demo:reset             # delete the demo database

# serve the demo through the real HTTP API + VS Code extension
npm run demo:serve
```

`demo:serve` points `MIND_DB_PATH` at the demo database and raises
`MIND_RETENTION_DAYS` before starting the server, because the historical
era's simulated dates are weeks in the past relative to real wall-clock
time and the real retention job would otherwise redact those signal bodies
on first run. It also sets `MIND_ADAPTERS=none`, so the server registers no
live Gmail, Calendar, GitHub, Outlook or Google Messages source and cannot pull
real mail or events into the demo database. The server applies the same lock
whenever `MIND_DB_PATH` names `demo.db`, so a manual `mind start` against it is
safe too — but set `MIND_RETENTION_DAYS` yourself first.

Once running, point the VS Code extension's `mind.serverUrl` setting at
`http://127.0.0.1:8787` — Thoughts, Review, and the Today brief read the
demo data exactly as they'd read real data. The status bar item (and the
**mind: Configure AI Provider** command) let you switch providers or models
without restarting the server.

## How resolution works (`src/replay.ts`)

For historical-era signals, after the real `ingest()` call produces a
`proposed` action (if it produces one at all — the model may have
escalated or surfaced it instead), the replay engine simulates an operator
reaction using a general heuristic, not a per-signal script:

- **discard** if the signal's body mentions a sensitive topic (budget,
  headcount, legal, scope change, a named CVE severity, breach, exploit,
  unauthorized access) — regardless of how good the draft reads, a careful
  operator does not wave these through
- **discard** roughly 1 in 4 of everything else, deterministically seeded
  from the signal's database ID, standing in for the ordinary rate at which
  a human improves on an early draft
- **approve** (simulate a send) otherwise

This heuristic only looks at the signal's own body — never at what the
model drafted or at a hardcoded expectation — because encoding "the model
will say X for signal Y" would reintroduce the scripting this redesign
removed. It exists to produce a believable mix of outcomes so the
auto-disable rule and the learning loop have real data to react to, not to
model good judgement.

Live-era signals are never touched by this step. They are read, once, by
`npm run demo:summary` or the extension, exactly as `ingest()` left them.

## Adding a fourth persona

1. Add `directions/demo/<id>/*.yaml`.
2. Add `src/personas/<id>.ts` exporting a `PersonaScenario` — plain signal
   bodies only, split into `historical`/`live` eras. Do not pre-compute a
   classification or draft; there is nowhere left in the type to put one.
3. Add it to `ALL_PERSONAS` in `src/seed.ts`.
