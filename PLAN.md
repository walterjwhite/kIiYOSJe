# mind — build plan

A local, single-operator system that manages my attention instead of my inbox.
It ingests events from messaging and mail sources, applies standing
**Directions** that I author, answers or files what it can, and surfaces only
the **Thoughts** that genuinely need my judgement.

Status: P0 to P5 implemented in code; Teams and email adapters are stubs. See
[STATUS.md](STATUS.md) for what is built, what is verified, and what remains.
This document is self-contained and assumes nothing
about where the project lives.

## 1. Thesis

The failure mode of most "AI assistant" tools is that they reorganize the flood
instead of reducing it: you get a nicer inbox, a summary, a triage queue. The
attention cost is unchanged.

`mind` inverts this. **Thoughts are the primary object; events are evidence.**
A message that a Direction can absorb is answered and dies as a Signal. A
Thought exists only where there is ambiguity, consequence, or a decision that
is mine to make.

The product metric is therefore not "messages handled" but:

> **signals per week ÷ thoughts per week** — this ratio must rise.

If it does not rise as Direction coverage grows, the model is wrong and the
design should change, not the prompts.

## 2. Non-goals

- Not a notification system. Nothing is pushed to me. There is no inbox.
- Not a chat assistant I have to prompt. It runs on ingest and review cadence.
- Not distributed. One process, one database, one machine.
- Not a task manager. Commitments are captured and linked, not worked.
- Not multi-user. Single operator; no accounts, no sync.

## 3. Architecture

Monolith: one Node process, SQLite file, localhost HTTP. Adapters are in-process
modules behind one interface, so a new source is a class, not an integration.

```
            ┌──────────── adapters (in-process) ────────────┐
            │  teams (web client bridge)   email (IMAP)      │
            └───────────────────┬───────────────────────────┘
                                │ Signal
                    ┌───────────▼───────────┐
                    │  pipeline             │  dedupe → classify → decide
                    └───────┬───────────────┘
             absorb         │         surface / escalate
        ┌───────────────────┴────────────────────┐
        │                                        │
  Action(draft/send)                        Thought
        │                                        │
        └──────────► SQLite ◄────────────────────┘
                        │
        ┌───────────────┴────────────────┐
        │  HTTP API 127.0.0.1:8787        │
        └───────────────┬────────────────┘
                        │
                 VS Code extension
        (thought tree · Today brief · directions · action review)
```

The pipeline is the only place decisions happen. Adapters never decide; the API
never decides; the extension never decides. That keeps behaviour auditable and
testable without a UI.

## 4. Data model

SQLite via Drizzle. Five tables; everything else is derived.

```ts
directions:  id, name, scopeKind, scopeValue, posture, standard,
             autonomy, confidenceMin, enabled, version, createdAt, updatedAt
signals:     id, adapter, externalId, threadId, sender, recipients, kind,
             body, receivedAt, urgencyHint, disposition, thoughtId,
             dedupeKey (unique)
thoughts:    id, title, body, state, directionId, nextAction, reviewAt,
             createdAt, updatedAt
actions:     id, thoughtId, signalId, kind, payload, status, adapter,
             createdAt, sentAt
events:      id, at, actor, kind, payload        // append-only audit
```

Enums (stored as text, validated by zod on write):

| field                 | values                                                  |
| --------------------- | ------------------------------------------------------- |
| `directions.posture`  | `absorb` · `draft` · `surface` · `escalate`             |
| `directions.autonomy` | `observe` · `draft` · `send`                            |
| `signals.disposition` | `new` · `absorbed` · `filed` · `promoted` · `escalated` |
| `thoughts.state`      | `seedling` · `active` · `parked` · `closed`             |
| `actions.status`      | `proposed` · `sent` · `discarded` · `failed`            |

`signals` is the high-volume table. Its `disposition` is what makes the ratio
measurable without keeping full history forever (see retention, §11).

## 5. Adapter contract

Every adapter implements exactly this. `send` is optional and declared, because
sources differ in permission — a messaging bridge may stream and send, while a
work mail account may only be readable.

```ts
export interface Adapter {
  readonly id: string;                       // "teams" | "email"
  readonly capabilities: { canSend: boolean; canStream: boolean };
  start(sink: (signal: NewSignal) => void): Promise<void>;
  stop(): Promise<void>;
  send?(draft: OutboundDraft): Promise<SendResult>;
}
```

A shared **contract test suite** runs against every adapter with a recorded
fixture stream, so a new source cannot ship half-conformant.

The Teams adapter bridges an existing web client already under my control — one
that can send messages and stream inbound ones. It subscribes to that stream,
maps payloads to `NewSignal`, and routes outbound drafts back through the same
client. The email adapter polls IMAP for read and saves replies to the Drafts
folder for send. Both are replaceable without touching the pipeline.

## 6. Directions

Authored by me as YAML, zod-validated, version-controlled in `directions/`.
Not a rules engine: a small, declarative vocabulary with a required `standard`
field that states what "handled" means.

```yaml
# directions/work/boss.yaml
name: boss-requests
scope: { kind: person, value: "boss@corp" }
posture: absorb
autonomy: draft            # observe | draft | send
confidenceMin: 0.7
standard: |
  Acknowledge same day. Restate the ask in one line. State when a plan or
  answer will arrive. Never commit to a date you were not given.
  Escalate if the request implies headcount, budget, or external commitment.
# Both optional. matchPrompt adds phrases checked against the signal body,
# beyond the literal scope.value substring match. responsePrompt adds
# handling guidance passed to the drafter alongside `standard`.
matchPrompt: "status update, progress check, where are we on"
responsePrompt: |
  Lead with current state in one sentence, then the next milestone and date.
guards:
  maxPerThreadPerHour: 1
  escalateOn: [headcount, budget, legal, external-commitment]
```

`scope.kind` is `person` | `project` | `topic` | `thread`. Rules are matched by
scope first — plus `matchPrompt`'s phrases, if present — then by classifier
output; the highest-specificity match wins and the match is recorded on the
Signal so every decision is explainable. Moving a signal to a different
Direction after the fact (the match itself was wrong, not just the draft) is
a **reclassification** — `PATCH /signals/:id` — logged separately from an
action override.

## 7. Decisions and permissions

Effective permission to send is the **conjunction** of three independent gates.
This is deliberate: any one of them can stop an outbound message.

```
adapter.capabilities.canSend
  && direction.autonomy === "send"
  && global.sendEnabled          // kill switch, default false
  && !guards.triggered           // rate, sensitive topic, new recipient
```

Default posture for every new source is `observe`: ingest, classify, and record
what it *would* have done, without writing anything. I add Directions only
after reading a week of observe output.

## 8. Pipeline

Per signal, in order, all synchronous except the classifier call:

1. **Dedupe** — `dedupeKey` from `adapter:externalId`; duplicates are dropped
   before anything else costs money.
2. **Normalize** — strip signatures/quotes, resolve participants, extract
   deadlines and explicit commitments.
3. **Match** — scope match against enabled Directions; no match means
   `escalated` only if the signal is addressed to me directly, else `filed`.
4. **Classify** — LLM structured output (zod schema): `directionId`,
   `confidence`, `intent`, `urgency`, `commitment?`, `sensitiveTopics[]`.
5. **Decide** — per `posture`:
   - `absorb` → draft a reply, then send if permitted (§7), else `proposed`
   - `draft` → draft only, always `proposed`
   - `surface` → create or attach to a Thought
   - `escalate` → create a Thought pinned to today's brief
6. **Record** — one `actions` row and one `events` row per decision, always,
   including "did nothing and why".

Commitments found in a signal are attached to the originating Thought's
`nextAction` and `reviewAt`; they are surfaced in the brief, never silently
promised.

## 9. HTTP API

Bearer token from `~/.config/mind/token`, bound to `127.0.0.1` only. No CORS
needed; the extension is a local client.

| method | path                | purpose                               |
| ------ | ------------------- | ------------------------------------- |
| GET    | `/health`           | liveness + adapter status             |
| GET    | `/brief`            | today's brief payload                 |
| GET    | `/thoughts?state=`  | thought list                          |
| POST   | `/thoughts`         | capture a thought (used by extension) |
| PATCH  | `/thoughts/:id`     | state, nextAction, reviewAt           |
| GET    | `/directions`       | all directions with match stats       |
| PUT    | `/directions/:id`   | edit name, posture, autonomy, standard, matchPrompt, responsePrompt, confidenceMin, enabled |
| GET    | `/actions?status=`  | review queue                          |
| POST   | `/actions/:id/send` | human approval of a proposed action   |
| POST   | `/actions/:id/discard` | reject, recorded as override       |
| PATCH  | `/actions/:id`      | edit a draft's body before sending    |
| POST   | `/signals`          | adapter ingress (internal only)       |
| GET    | `/signals?range=`   | list signals, `today`\|`7d`\|`30d`\|`all`, newest first |
| PATCH  | `/signals/:id`      | reclassify: move to a different direction, logged as `signal.reclassified` |
| GET    | `/metrics?window=`  | signals/thoughts ratio and rates, plus byChannel and dailyVolume |
| GET    | `/metrics/signals?directionId=\|adapter=\|day=` | Analytics drill-down: the signals behind one bar/row |
| GET    | `/events?kind=&actor=&since=&limit=` | the Journal — read-only window onto the audit log |
| GET    | `/proposals?status=` | learning-loop proposals               |
| POST   | `/proposals/run`    | generate proposals now                |
| POST   | `/proposals/:id/accept` \| `/reject` | resolve a proposal     |
| GET    | `/admin/notifications` | the notification quiet-period window, plus whether a notification sent now would be allowed |
| PUT    | `/admin/notifications` | set the quiet-period window (days, start/end time)       |

Approving an action and discarding it are both events — overrides are the
training signal for §12. Reclassifying a signal is a separate, explicit
correction: it means the match was wrong, not that the draft was wrong.

## 10. VS Code extension

The only UI for now. Its own Activity Bar icon opens a dedicated sidebar
container (not nested in Explorer) — native tree views where possible;
webviews for the brief, Analytics, and the Devices placeholder.

- **Queue** tree view (view id `mind.review`) — `proposed` actions, one line
  each, with inline approve/discard commands. This is the only place I
  authorize a send.
- **Thoughts** tree view — `active` first, then `seedling`; grouped by Direction.
  Item click opens the thought body as a markdown editor.
- **Signals** tree view — every signal, defaulting to today, widened with
  `mind.signals.setRange`. Inline **Reclassify** command moves a signal to
  a different Direction when the match itself was wrong.
- **Journal** tree view — read-only window onto `events`, the append-only
  audit log; nothing here is edited from the extension.
- **Today** webview — Directions in effect, thoughts needing a decision,
  actions proposed, commitments due, and a one-line absorb summary.
- **Analytics** webview — volume by Direction, by channel, and by day;
  every row and bar is clickable and opens the matching signals below it.
- **Devices** webview — placeholder only. No pairing exists yet; this
  previews the planned layout and says so, pending the Android app this
  is meant for and PLAN.md's own P6 deferral of remote authentication.
- **Commands** — `mind.capture`, `mind.pause` (kill switch), `mind.brief`,
  `mind.direction.edit`, `mind.analytics`, `mind.devices`,
  `mind.signal.reclassify`, `mind.notifications.configure`.
- **No badge counts, no status-bar counter, no notifications.** Absence is the
  feature; a count would reintroduce the thing being removed.

### Notification quiet period

A setting, not a send gate: `~/.config/mind/notifications.json` holds a
day-of-week + time-of-day window (default Mon–Fri 08:00–15:00, local time)
outside of which mind does not proactively notify me — e.g. a future
"your brief is ready" ping. `isWithinNotificationWindow()` in `@mind/core`
is the single check any future proactive-notification code calls before
firing. It is deliberately separate from everything else that gates
behaviour:

- It never touches ingestion, matching, classification, or drafting —
  those keep running regardless of the time of day.
- It never touches the §7 send gates — whether an autonomous send goes out
  is governed by `autonomy`, the kill switch, and guards, not by this.
- It never blocks something I ask for right now (`mind.brief`, `mind
  capture`, approving a draft) — those are explicit, one-off acts I
  initiated, not the system interrupting me.

`GET`/`PUT /admin/notifications` exposes it over HTTP, read fresh on every
call like `ai.json` — no restart needed. The extension's **mind: Configure
Notification Quiet Period** command drives it from the editor.

## 11. Stack

Node 24 LTS, TypeScript strict, ESM, npm workspaces. Versions verified against
npm on 2026-11-14; re-check with `npm view <pkg> version` when scaffolding.

| concern        | choice                                     | note                                    |
| -------------- | ------------------------------------------ | --------------------------------------- |
| HTTP server    | `hono@4.13` + `@hono/node-server@2`        | Small, typed, zero-dep routing          |
| DB             | `better-sqlite3@13.2`                      | Sync API; correct for single process    |
| ORM/migrations | `drizzle-orm@0.45.4` + `drizzle-kit@0.31`  | Plain SQL migrations, reviewable        |
| Validation     | `zod@4.6`                                  | One schema for config, API, LLM output  |
| LLM access     | `ai@7` (Vercel AI SDK)                     | Provider-agnostic, structured output    |
| Email          | `imapflow@2.11`, `nodemailer@10.5`         | Read + save-to-Drafts                   |
| Logging        | `pino@10`                                  | JSON to file, readable in dev           |
| Tests          | `vitest@5`                                 | Runs headless                           |
| Language       | `typescript@7.0`                           | Native compiler; fall back to 5.9 only if a dependency's types fail under it |
| Extension      | `@types/vscode@1.146`                      | Keep `engines.vscode: ^1.146.0` equal to the installed API version |

Drizzle is on a 1.0 release candidate; stay on 0.45.x stable until it lands.
Zod 4 is the current major, so the classifier schema and the HTTP validation
share one version. Do not adopt `better-sqlite3` alternatives for encryption —
use the OS/user permissions below instead.

**Retention:** full `signals.body` is kept 30 days by default (configurable),
then replaced with sender, disposition, and match — enough to compute metrics
and improve Directions without holding years of message bodies.

**Privacy boundary:** everything is local except classifier and drafting calls
to the model provider. That is the one deliberate egress and it must be visible
in config. A local-model provider can be swapped in without touching the
pipeline because of the abstraction above.

**Location:** DB at `~/.local/share/mind/mind.db`, mode `600`; token and
credentials at `~/.config/mind/`, mode `600`; never under version control.

**Note on `skipLibCheck`:** `drizzle-orm@0.45.4` ships declarations for
MySQL/SingleStore/Gel drivers that do not type-check under TS 7's stricter
abstract-method rules. The failures are in vendor code, not in `mind` source.
`skipLibCheck: true` is set globally rather than per-package because the errors
appear in `drizzle-orm`'s own `.d.ts` files and affect all packages that import
it. If Drizzle releases a 0.45.x patch that fixes these declarations, remove
`skipLibCheck` and verify.

## 12. Learning loop

Weekly, the agent proposes Direction diffs rather than making them:

- where I discarded a proposed action, propose narrowing the Direction;
- where I approved one repeatedly, propose widening autonomy;
- where multiple signals were promoted into one Thought, propose a new Direction
  covering that pattern.

Delivered as a diff in the extension against `directions/*.yaml`. I accept or
reject; nothing changes silently. This is how the system learns my judgement
instead of me writing ever-more-specific rules.

## 13. Project layout

Standalone project; it depends on nothing but its own workspace and can live at
any path.

```
.
├── PLAN.md                 # this document
├── package.json            # workspaces; scripts: dev test lint migrate
├── tsconfig.base.json
├── directions/             # YAML, version-controlled
├── packages/
│   ├── core/               # types, zod schemas, db, config, clock
│   ├── pipeline/           # dedupe, normalize, match, classify, decide
│   ├── adapters-teams/
│   ├── adapters-email/
│   ├── server/             # hono app, auth, routes
│   └── cli/                # mind start|pause|observe|metrics
└── extension/              # VS Code extension
```

Conventions: focused files with one responsibility, small functions, a unit
test alongside every non-trivial behaviour, no business logic in the extension
or the adapters.

## 14. Phases

Each phase ends with something usable, and states how it is verified.

**P0 — Skeleton (1–2 days).** Workspace, strict TS, Drizzle schema + migration,
Hono on `127.0.0.1:8787`, token auth, `/health`, `mind start`, vitest.
*Done when:* `npm run dev` serves `/health`, migration is idempotent, tests pass.

**P1 — Teams ingest, observe only (2–3 days).** Teams adapter linked to the
existing web client, dedupe, persistence, signal count visible via `/metrics`.
*Done when:* a full working day of traffic is stored with zero outbound
messages, restart produces no duplicates, and the count matches the client's.

**P2 — Directions + draft-only absorb (3–4 days).** YAML loader, matcher,
classifier with structured output, draft generation into `actions`, review UI,
Today brief.
*Done when:* ≥60% of signals match a Direction, drafts are ones I would have
written, nothing has been sent, and every discard is recorded.

**P3 — Email with filters removed (3–4 days).** IMAP adapter, save-to-Drafts,
same pipeline; volume nearly doubles on purpose, since this system is meant to
be the filter.
*Done when:* drafts appear in the Drafts folder, dedupe holds by `Message-ID`,
and the brief stays readable at the higher volume.

**P4 — Autonomy, narrowly (2–3 days).** Per-Direction `send` opt-in, the §7
gates, kill switch, rate limits, audit completeness.
*Done when:* a send happens only for a Direction with `autonomy: send`,
`mind pause` stops all sends immediately, and every outbound message is
reconstructible from `events`.

**P5 — Learning loop (2–3 days).** Weekly Direction-diff proposal, metrics view.
*Done when:* the first proposal is generated from real override data.

**P6 — Deferred.** Mobile client (same API, read-mostly plus capture), richer
retrieval (FTS5 first, embeddings only if FTS5 proves insufficient).

## 15. Metrics

Recorded from P1 onward, so the thesis is testable rather than asserted:

| metric                   | why it matters                           |
| ------------------------ | ---------------------------------------- |
| signals/week             | the load arriving                        |
| thoughts/week            | the load reaching me — must fall         |
| absorb rate by Direction | where coverage is working                |
| override rate            | where my judgement disagrees with policy |
| time-to-decision         | whether the brief is actually quicker    |
| sends without revert     | trust earned before widening autonomy    |

## 16. Risks

| risk                             | mitigation                                                    |
| -------------------------------- | ------------------------------------------------------------- |
| Messaging bridge is unofficial   | adapter isolated behind the contract; expect drift, keep response mapping in one file |
| Employer policy on programmatic access | confirm before P1; if prohibited, that source stays observe-only via the client and email carries the load |
| Auto-reply to a sensitive sender | `escalateOn` topics, sender allowlist, default `observe`, send off until P4 |
| Classifier confidence theatre    | `confidenceMin` per Direction plus override rate; a Direction overridden >20% is disabled automatically |
| Attention cost returns as UI     | no counts, no badges, no push; the brief is a page I open, not a stream |
| Cost creep                       | cheap model for classify, larger only for drafting; dedupe before inference |
| Data loss (single file)          | nightly `sqlite3 .backup` to a local rotations directory, 14 days |
| TypeScript 7 is new              | pin exact versions; if a dependency's types fail, drop to TS 5.9 for that build and record why |

## 17. Open decisions

1. **Model provider** — pinned per task (classify vs draft). Stop and let me choose.
2. **Teams transport details** — Stub out interface for now. I may be able to re-use an existing teams web client.
3. **Email write capability** — Stub out interface for now.
4. **Remote authentication** — deferred to P6.
