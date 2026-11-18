# mind — implementation status

Last updated: 2026-11-16. Measured against [PLAN.md](PLAN.md).

**Build:** all packages compile under TypeScript 7 strict. **Tests:** 134 passing across 27 files.
**The LLM paths have now been run for real**, against a local Ollama model (`qwen2.5:3b-instruct`,
the default provider) — `classify()`, `draft()`, and a full `ingest()` call were verified end to
end, and all three demo personas were seeded with real model calls (see `packages/demo-data/README.md`).
Adapter traffic has not been verified against live accounts, and VS Code-interactive
testing is still not done — see "Not verified" below.

## Phase status

| Phase | Status | Done-when criterion | Met? |
| ----- | ------ | ------------------- | ---- |
| P0 Skeleton | Complete | server serves `/health`, migration idempotent, tests pass | Yes. `/health` verified through `npm start` (same `dist/main.js` that `npm run dev` runs, minus `--watch`). The sandbox blocked running `npm run dev` itself. |
| P1 Email and calendar ingest | Implemented, unverified | a day of traffic stored, no duplicates on restart, count matches client | No. The unofficial Teams adapter was removed for third-party terms-of-use reasons. Gmail, Outlook (Graph), and Calendar are implemented; not yet run against a live account. Dedupe, persistence and `/metrics` work via `POST /signals`. |
| P2 Directions + draft absorb | Tested with a real model | ≥60% match a Direction, drafts match what I'd write, discards recorded | Partially measured. In one real seed run across 30 synthetic signals, several matched the catch-all instead of an intended Direction because `match()` uses literal substring matching and real phrasing doesn't always contain the exact scope string (known gap, #12 below). Drafts are real model output, not scripted, and are mediocre at 3B-model quality — acceptable for a free local default, worth comparing against a cloud model. Discards are recorded (tested). |
| P3 Email | Implemented, unverified | drafts in Drafts folder, Message-ID dedupe | No. Gmail send/reply and Outlook (Graph) draft-then-send are implemented; not yet run against a live mailbox. |
| P4 Autonomy | Code complete, no end-to-end path | send only for `autonomy: send`, `mind pause` stops all sends, sends reconstructible from `events` | Partly. Gates and pause are tested with a fake adapter. No real adapter can send. |
| P5 Learning loop | Tested with real override data | first proposal generated from real override data | Yes, partially. In the same real seed run, two personas' deliberately loose directions accumulated real overrides (simulated operator reactions to real model drafts) and the learning loop generated real `narrow` proposals from that data — confirmed via `GET /proposals`. This is probabilistic: it is not guaranteed on every seed run, because the classification outcomes that drive it are real model output, not scripted. |
| P6 Mobile, FTS5 | Deferred | n/a | n/a |

## Mockup reconciliation (this round)

A separate `mockup/` HTML/JS prototype explored a richer UI model (match/
response prompts on a Direction, reclassification, an interactive Analytics
drill-down, a ranged Signals view, a Journal tab, and a Devices/pairing
tab). This round ports the parts of that exploration that fit the real
architecture — server (`packages/server`) plus the VS Code extension only,
no Android yet:

- **`matchPrompt` / `responsePrompt`** — two new optional columns on
  `directions` (migration `0002`). `matchPrompt` is a comma/line-separated
  list of phrases checked against the signal body in `match.ts`, in
  addition to the existing literal `scope.value` substring check — a direct
  fix for gap #12 below, without adding an LLM call to the synchronous
  match step. `responsePrompt` is passed to `draft()` alongside `standard`
  for extra handling guidance. Both are optional and backward compatible;
  existing YAML files with only `scope`/`standard` behave exactly as
  before. See `directions/work/boss.yaml` for an example of both fields.
- **Reclassification** — `PATCH /signals/:id` moves a signal to a different
  `directionId` and logs a `signal.reclassified` event, distinct from an
  action override (`/actions/:id/discard`, which means "the draft was
  wrong") — this means "the match itself was wrong." Reachable from the
  extension's new Signals tree view via **mind: Reclassify Signal**.
- **Signals view, ranged** — `GET /signals?range=today|7d|30d|all` (did not
  exist before this round; only ingress existed). New **Signals** tree
  view in the extension, defaulting to `today`, widened via **mind: Set
  Signals Range**.
- **Analytics, interactive** — `/metrics` now also returns `byChannel` and
  `dailyVolume`; a new `GET /metrics/signals?directionId=&adapter=&day=`
  drill-down endpoint (requires at least one filter) backs a new
  **Analytics** webview (`mind.analytics` command) where every direction
  row, channel bar, and daily-volume bar is clickable and opens the
  matching signals below it.
- **Journal** — `GET /events` exposes the existing append-only audit log
  read-only, with `kind`/`actor`/`since`/`limit` filters. New **Journal**
  tree view in the extension. This is a window onto the same `events`
  table every decision already writes to, not a new log.
- **Devices** — intentionally a placeholder only. PLAN.md defers remote
  authentication to P6 and there is no second client to pair yet (no
  Android app, per this round's explicit instruction). The new **Devices**
  webview (`mind.devices` command) reuses the mockup's devices-table/
  pairing-panel layout as a static preview with a visible "development in
  progress" notice — no device registry, scoped tokens, or real pairing
  flow exist.
- **Deliberately not ported:** the mockup's "recipient is free" scheduling
  option and the split-group-chat-signal model. Both are meaningless
  without a live chat adapter — there is no Teams integration in this tree,
  and the remaining sources are mail and calendar — and would be speculative
  to build against it.

## Notification quiet period (this round)

TODO.md Foundations §6 names "notification choices" as a per-person
setting; this implements the first concrete piece of it. `@mind/core`
gained `QuietPeriodConfig`, `quietPeriodConfig()`/`writeQuietPeriodConfig()`
(reads/writes `~/.config/kIiYOSJe/mind/notifications.json`, mode 600, same pattern
as `ai.json`), and `isWithinNotificationWindow(at?, config?)` — a pure
function, 9 tests in `config.test.ts` covering the default window, both
boundary minutes, a weekend block, `enabled: false`, a midnight-crossing
custom window, and a custom day list.

`GET`/`PUT /admin/notifications` exposes it over HTTP (3 tests in
`app.test.ts`); the extension's **mind: Configure Notification Quiet
Period** command (`notifications-config.ts`) drives it with a QuickPick
for on/off, a multi-select for days, and two validated `HH:MM` inputs.

This is a standalone primitive, not yet called from anywhere, because
nothing in the system proactively notifies the person today — PLAN.md's
own non-goal ("not a notification system... nothing is pushed to me") and
the "no badge counts, no status-bar counter, no notifications" rule for
the extension mean there is no OS-level push to gate yet. It is built so
that the one real candidate — PLAN §6's "notify when it is ready" for the
morning brief, were it ever implemented — has a check to call before
firing. It is explicitly **not** a send gate: `decide()` and the §7 send
gates are untouched, and asking for something right now (`mind.brief`,
`mind.capture`) is never affected by this window.

## Implemented and tested

- **Core:** five-table Drizzle schema, two migrations, config, pino logger, zod schemas, status file (`~/.data/kIiYOSJe/mind/status.json`, atomic, mode 600).
- **Pipeline:** dedupe, normalize (quote stripping), match (person > thread > project > topic > catch-all), classify, draft, decide, record.
- **Catch-all direction** (`system/catch-all`): lets the system answer or acknowledge signals no authored Direction covers. Explicit Directions always win.
- **Escalation deadlines:** `escalateBy` from the classifier's explicit deadline, else urgency (high 2h, medium 24h, low 72h; low-urgency acknowledgements and information get none). A 60s checker promotes overdue seedling Thoughts to `active` and writes an audit event.
- **Send gates (§7):** adapter capability, `autonomy: send`, `MIND_SEND_ENABLED=true`, no triggered guard, and no pause flag. Autonomous send is re-checked at send time. An empty draft is never auto-sent.
- **Kill switch:** `mind pause` / `mind resume` and `POST /admin/pause|resume` create or remove `~/.config/kIiYOSJe/mind/paused`. It takes effect immediately and also blocks human-approved sends (HTTP 423).
- **Guards:** `escalateOn` topics and `maxPerThreadPerHour`.
- **Auto-disable:** a Direction is disabled when its override rate exceeds 20% with at least 5 decided actions.
- **Retention:** signal bodies redacted after 30 days (configurable). **Backup:** startup and daily `.backup()`, 14 files kept.
- **Learning loop:** proposes narrowing, widening, or a new Direction. Proposals are events. `GET /proposals`, `POST /proposals/run|:id/accept|:id/reject`. Accepting updates the DB row and returns the YAML edit you must make by hand, because YAML is the source of truth and a reload would revert a DB-only change.
- **Model provider config:** four providers — `ollama` (local, free, default), `openai`, `anthropic`, `google`. The whole config (provider, classify/draft model names, base URL, API key) lives in `~/.config/kIiYOSJe/mind/ai.json`, read fresh on every call — no server restart needed to switch. `GET`/`PUT /admin/ai-config` exposes this over HTTP; the VS Code extension's **mind: Configure AI Provider** command and a status-bar toggle drive it from the editor.
- **API:** all routes in PLAN §9, plus `/admin/*` (including `/admin/ai-config`), `/proposals/*`, `PATCH /actions/:id` (edit a draft before approving). `/metrics` returns all six planned metrics plus a per-Direction breakdown. `/directions` includes match stats.
- **Demo data (`@mind/demo-data`):** three personas (Software Engineer, Project Manager, DevSecOps Engineer) with synthetic signal bodies only — no pre-computed classification or draft. Every signal is replayed through the real `classify()`/`draft()`/`decide()` pipeline against the configured provider. A "historical" era gets a simulated operator reaction (approve/discard, by a general sensitive-topic + pseudo-random heuristic, never a per-signal script) to build believable override history; a "live" era is left exactly as the model decided, for the operator to act on through the extension. `npm run demo:seed` / `demo:serve` / `demo:summary` / `demo:reset`. One full real seed run (30 signals, ~3 minutes on a local 3B model) produced 6 live proposed actions, 2 real learning-loop proposals, and 1 real auto-disabled direction — all confirmed via the HTTP API.

## Not verified

- **VS Code extension** compiles, including the new AI-provider status bar item, configure command, this round's Signals/Journal tree views and Analytics/Devices webviews, and the notification quiet-period command, but has never been loaded in VS Code and clicked through interactively. The thought-open, approve/discard menus, brief refresh button, pause/resume commands, signal reclassification, the Analytics drill-down clicks, and the quiet-period QuickPick flow are all untested in the actual editor — they are covered by the server-side route tests only (`app.test.ts`, `match.test.ts`, `config.test.ts`), not by driving the webview/tree UI itself.
- **`/send` for human approval** is tested only up to the pause check. No real adapter implements `send`, so a successful human-approved send to a real destination has never run — only the demo's no-op adapter, which proves the gate logic but not real delivery.
- **Cloud providers** (openai/anthropic/google) are untested this session — only ollama was exercised for real. The provider-switch code path itself is exercised by `admin.ts`'s PUT handler and the extension command, but no actual cloud call has been made.

## Gaps against PLAN.md

1. **Adapter contract test suite (§5)** does not exist.
2. **Normalize (§8.2):** signature stripping, participant resolution, and deadline/commitment extraction are not implemented. Commitments come only from the classifier.
3. **`filed` disposition (§8.3)** is never produced. The catch-all replaced "no match → escalated or filed", so nothing is silently filed. Decide whether you want a quiet "file" path for mail not addressed to you.
4. **`escalate` posture** creates a Thought but does not pin it to the brief.
5. **Thoughts tree** is a flat sort. PLAN §10 asks for grouping by Direction.
6. **Learning-loop UI:** proposals are API-only. The extension shows no diff view.
7. **`mind observe`** prints metrics. PLAN §14 describes it as a mode switch. No global observe mode exists. The per-Direction `autonomy: observe` does.
8. **P2 "≥60% match"** is meaningless now that the catch-all matches everything. Measure it on explicit Directions only (`byDirection` excluding `system/catch-all`).
9. **Override tracking:** `sendsWithoutRevert` counts sent actions only. Reverts are not tracked.
10. **Dependencies:** `npm audit` reports 4 moderate vulnerabilities, not reviewed. `skipLibCheck: true` is set because `drizzle-orm@0.45.4` declarations fail under TypeScript 7 (PLAN §11).
11. **Git:** nothing is committed.
12. **`match()` uses literal substring matching** on each Direction's `scope.value`, **partially addressed this round**: a `matchPrompt` field now lets a direction's author list additional phrases/synonyms checked against the signal body (see "Mockup reconciliation" above), still without an LLM call in the synchronous match step. This helps when the author anticipates the gap, but doesn't help an existing direction nobody has revisited — classifier-assisted or fuzzy matching remains a real option for a future round.
13. **`escalateBy` grounding:** the classifier prompt now includes the signal's `receivedAt` so relative deadlines ("by Friday") resolve to the correct date — this was wrong (resolving to 2023) before the fix made this session. Not yet re-verified against a cloud provider, only ollama.

## Open decisions (PLAN §17)

1. **Model provider:** defaults to `ollama` (local, free, `qwen2.5:3b-instruct`). Switch via the VS Code **mind: Configure AI Provider** command, the status-bar item, or `PUT /admin/ai-config`. HTTP providers (`ollama`, `openai`, `anthropic`, `google`, `openai-compatible`, `copilot`) go through the Vercel AI SDK; `kiro` and `copilot-cli` are driven over ACP (`kiro-cli acp`, `copilot --acp`). Cloud and CLI providers remain unverified against live accounts this session.
2. **Teams transport:** removed. The unofficial `teams-api` web-client bridge was
   deleted for third-party terms-of-use reasons; a supported integration would
   need Microsoft Graph with an authorized app registration.
3. **Email write capability:** decided — Gmail `messages/send` and Outlook
   Graph create-draft-then-send.
4. **Remote authentication:** deferred to P6.

## This round — direction, measurement, live testing (2026-11-18)

Written up as [DIRECTION.md](DIRECTION.md) (the bet and the five moves) and
[LIVE.md](LIVE.md) (the runbook for real accounts). Code changes:

- **Commitments are state machines** (`@mind/core/commitments.ts`, migration
  `0005`). `thoughts.commitment` holds JSON with `status`, `dueDate`,
  `lastVerifiedAt`, `supersededBy`, and an append-only `previousStates` array.
  Ingest reconciles **per thread**: a later message either verifies the open
  commitment (`commitment.verified`) or replaces it
  (`commitment.superseded`), so a changed deadline cannot leave two live
  reminders. An absorbed signal that carries a commitment now creates a Thought
  — previously the promise was silently dropped when no Thought was created.
- **Two-sided reply tracking** (`signals.awaitingReplyAt` /
  `replyReceivedAt`, `thoughts.awaitingReplyAt`). A successful send — autonomous
  or approved — starts the clock; an inbound signal from someone other than
  `operator.addresses` closes it and writes `reply.received`. `absorbedUnanswered`
  is reported separately in the coverage curve because "answered into a void" is
  not absorption.
- **`disputed` Thoughts.** `decide()` returns a disputed escalation when the
  classifier is confident but reports `answerable: false` with a blocker on a
  question or task: a Thought with `state: disputed` and `disputedReason`, no
  draft. Acknowledgements and information are excluded. Low confidence still
  escalates as before (not disputed).
- **Direction preview** (`POST /directions/preview`, `mind preview`): dry-runs
  the matcher and guards over stored signals, optionally against the real
  classifier (capped at 10 samples). Writes nothing but one
  `direction.previewed` event.
- **Coverage curve** (`GET /metrics/coverage`, `mind coverage`,
  `packages/pipeline/src/coverage.ts`): absorb rate and signals/thoughts ratio
  per week against the number of Directions, with a 0.6 target and
  `meetsTarget` per bucket. `/brief` gained the evening half: `handled`, plus
  `commitments`, `awaiting`, and `thoughts.disputed`.
- **Undo and explain** (`POST /signals/:id/undo`, `GET /signals/:id/explain`,
  `mind explain`). Undo refuses after a send; it discards proposed actions,
  closes the Thought if this signal created it, and records `signal.undone`.
  The `signal.processed` event now carries `intent`, `confidence`, `urgency`,
  `answerBlocker`, `sensitiveTopics`, `commitment*`, `matchedBy`, `reason`, and
  `disputed`.
- **GitHub adapter** (`github`, read-only, `canSend: false`): three searches —
  review requested, assigned, changes requested on yours. One signal per
  (PR, reason); `directions/work/github-prs.yaml` matches the `Reason:` line.

Verified: `npm run lint` and `npm test` (see the run recorded in the commit).
Still unverified: no live account has been connected, the GitHub adapter has
never called the real API, the migration has not run against an existing
`mind.db` with data, and the commit prompt's new `commitmentDueDate` field has
only been exercised through the schema, not a real model.
