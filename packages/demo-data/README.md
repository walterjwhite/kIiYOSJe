# @mind/demo-data

Deterministic, hand-authored demo data for three personas, replayed through
the real pipeline so a live walkthrough or screen recording shows the actual
engine deciding things — not a mockup.

No real credentials, no real adapters, no LLM calls, no network traffic.
`classify()` and `draft()` are skipped via `ingest()`'s override parameter;
everything else — dedupe, match, decide, record, the escalation checker, the
auto-disable rule, and the learning loop — runs for real against a dedicated
SQLite file at `~/.local/share/mind/demo.db`. This file is never the real
`mind.db` and the demo never reads or writes your real directions outside
`directions/demo/`.

## Personas

| Persona | What it proves |
| --- | --- |
| **Software Engineer** (`engineer`) | High-volume absorb with `autonomy: send`; CI noise filed as evidence instead of answered; a `production outage` escalation driven by the confidence floor, and a second case (`eng-6b`) that isolates the `escalateOn` guard specifically — a high-confidence draft exists but the autonomous send is blocked. |
| **Project Manager** (`pm`) | Drafts held for approval rather than inventing numbers; the single clarifying question for an ambiguous request; a deliberately loose direction (`vendor-noise`) that accumulates overrides until the learning loop proposes raising its `confidenceMin`. |
| **DevSecOps Engineer** (`devsecops`) | A `posture: escalate` direction reaching the operator unconditionally; a `posture: absorb, autonomy: send` direction whose `escalateOn` guard blocks a specific high-confidence send (`sec-5b`); and `dependabot`'s override rate crossing 20%, triggering automatic direction disable. |

Each signal in `src/personas/*.ts` carries a `narrative` field explaining
exactly what it demonstrates and why its confidence/urgency/guard values were
chosen — read these alongside the code if you're verifying a claim.

## Usage

```bash
# from the workspace root
npm run demo:seed              # reset + seed all three personas
npm run demo:seed engineer pm  # seed only specific personas
npm run demo:summary           # print the aggregate numbers
npm run demo:reset             # delete the demo database

# serve the demo through the real HTTP API + VS Code extension
npm run demo:serve
```

`demo:serve` points `MIND_DB_PATH` at the demo database and sets
`MIND_RETENTION_DAYS` to a very large number before starting the server.
**This second part matters**: the demo's simulated dates are weeks in the
past relative to real wall-clock time, and the real retention job redacts
signal bodies older than 30 days by default. Starting the server against
the demo DB without raising `MIND_RETENTION_DAYS` will silently redact the
narrative content on first run. If you start the server manually against
`demo.db` (e.g. via `mind start` with `MIND_DB_PATH` set by hand), set
`MIND_RETENTION_DAYS` yourself first.

Once running, point the VS Code extension's `mind.serverUrl` setting at
`http://127.0.0.1:8787` as usual — the Thoughts tree, Review panel, and
Today brief all read the demo data exactly as they would read real data.

## How replay works (`src/replay.ts`)

1. Loads only `directions/demo/<persona-id>/*.yaml` — never the shared
   `directions/` tree — so the demo can never pick up or interfere with a
   direction you've authored for real use.
2. Registers a no-op `demo-email` adapter that declares `canSend: true` and
   `send()`s nothing over the network; it only returns a synthetic
   `externalId`, so every autonomy and guard gate in `decide()`/`ingest()`
   is exercised exactly as it would be with a real adapter.
3. Sets `MIND_SEND_ENABLED=true` for the duration of replay (restored
   afterward) — otherwise the global kill switch alone would block every
   autonomous send and the demo could never show a guard specifically doing
   the blocking.
4. Replays each signal through `ingest()` with a pre-authored
   `ClassifierOutput` and draft body, in `atHour` order.
5. For actions `ingest()` left in `proposed` state, simulates the operator's
   review: a hardcoded discard list (`DISCARD_ON_REPLAY`) matches each
   persona's narrative exactly — every externalId in that list corresponds
   to a signal whose narrative says the operator would discard the draft.
   A second list (`EXPECT_PROPOSED_NOT_SENT`) asserts that specific actions
   were *correctly left proposed by `ingest()` itself* — i.e. a guard did
   its job — and logs a warning if that assumption and the engine's actual
   behaviour disagree, so a future change to `decide()` or a guard can't
   silently break the demo's claims without a visible warning in the seed
   log.
6. Runs the real escalation checker once, so deadlines already in the past
   (relative to real "now") are promoted immediately rather than waiting
   for the next tick.
7. Runs the real learning loop once per persona, so `GET /proposals` has
   real proposals generated from the override data just created, exactly as
   a week of real operation would produce.

## Adding a fourth persona

1. Add `directions/demo/<id>/*.yaml`.
2. Add `src/personas/<id>.ts` exporting a `PersonaScenario`.
3. Add it to `ALL_PERSONAS` in `src/seed.ts`.
4. If any signal is meant to demonstrate a guard blocking an otherwise-valid
   autonomous send, add its `externalId` to `EXPECT_PROPOSED_NOT_SENT` in
   `src/replay.ts` and verify the seed log prints no warning for it.
