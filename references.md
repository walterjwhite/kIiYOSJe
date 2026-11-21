# references

Prior art for `mind`, and the ledger of which ideas came from where.

**Written 2026-11-18, after the pipeline was built.** I did not survey the
landscape before designing this; I went looking once it worked. So this is a
retrospective map, not a reading list, and the honest question for each row is
not "what inspired this" but "what did I discover I had independently
reproduced, and what did I change afterwards". Every row carries that status:

| status | meaning |
| --- | --- |
| `independent` | built before I looked; the overlap was found afterwards |
| `adopted` | `mind` changed because of it; the row says what |
| `planned` | worth taking, not built |
| `rejected` | considered on purpose and not taken, with the reason |

No code was copied from any project below. See [Licences](#licences).

## 1. What this document is for

Three audiences, one file:

1. **A reader deciding whether to trust the claim.** The pipeline here
   (ingest → rule match → LLM classify → draft → human approve → audit) is not
   new. This file says so, and points at the projects that do it better than I
   do today.
2. **A judge reading the repo** — anything pre-existing must be disclosed rather
   than discovered. `.kiro/steering/competition.md` treats undisclosed prior art
   as a disqualifier, so silence is the expensive option.
3. **Me, in three months** — where to look when a specific mechanism needs to
   get better, and which ideas I already ruled out so I do not re-litigate them.

## 2. Concept ledger

### 2.1 Policy: authored rules that decide what happens to a message

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Plain-language rule matching by sender/topic, with actions to take | Inbox Zero "AI rules"; MailTriage criteria; `mail-sorter` | `directions/*.yaml`, `packages/pipeline/src/match.ts` | `independent` |
| Per-rule confidence floor before acting | Inbox Zero "draft confidence" (all / standard / high); `smartmail` confidence gate | `directions.confidenceMin`, `classify.ts`, `decide.ts` | `independent` |
| Global dry-run / observe mode | MailTriage per-rule dry-run on by default; `mail-sorter` dry-run default; Aziru never auto-sends | `autonomy: observe`, per Direction rather than global | `independent` |
| A catch-all rule so nothing is silently dropped | Inbox Zero default rule set | `fallback-direction.ts` (`system/catch-all`) | `independent` |
| Rule authors can test a rule against recent mail before enabling it | Inbox Zero rule **Test** tab and **History** ("what matched and why") | `POST /directions/preview`, `mind preview` — dry run over stored signals, optional classifier pass | `adopted` (2026-11-18) |
| Deterministic, ordered, first-match-wins pre-rules ahead of the LLM | OpenLoomi `classifier-rules.json` (safe AST, closed op set, confidence floor) | `matchPrompt` phrase list is a weaker version of this | `planned` |

The part of `Directions` I have not found elsewhere: a **required `standard`
field** stating what "handled" means for that scope, so the drafter is judged
against an authored standard rather than "write something plausible", plus
`posture` × `autonomy` as separate axes (what to do vs. how much permission).

### 2.2 Approval and the send path

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Drafts wait for one-tap human approval; nothing sends itself | Inbox Zero confirmation cards; Aziru; LangGraph `interrupt` / `HumanInTheLoopMiddleware` | `actions.status = proposed`, `POST /actions/:id/send`, extension Queue | `independent` |
| Several independent gates must all hold before an outbound action | OpenLoomi "Automation Rules" (off by default) + dry-run `⚠ OUTBOUND` flag; Gatelet per-account YAML policy | `decide.ts` conjunction: `canSend` ∧ `autonomy: send` ∧ `MIND_SEND_ENABLED` ∧ no guard ∧ no pause flag | `independent` |
| A kill switch that takes effect immediately | OpenLoomi Settings toggles | `~/.config/kIiYOSJe/mind/paused`, `mind pause|resume` | `independent` |
| Show the resolved gates on the approval card, not just the draft | OpenLoomi decision card (evidence + outbound warning on the card) | Queue shows the draft only | `planned` |

### 2.3 Audit, explanation, undo

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Append-only log of every decision, including "did nothing and why" | `smartmail` audit log with reasoning; OpenLoomi Audit Log | `events` table, `GET /events`, Journal view | `independent` |
| The log row explains *why*, in the classifier's own terms | `smartmail`; OpenLoomi "Evidence / Receipt" | `signal.processed` carries intent, confidence, urgency, blocker, sensitive topics, commitment, match reason; `GET /signals/:id/explain`, `mind explain` | `adopted` (2026-11-18) |
| Undo of a decision after the fact | `smartmail undo` | `POST /signals/:id/undo` — refused after a send; one `signal.undone` event | `adopted` (2026-11-18) |
| Overrides as training data rather than as support tickets | Inbox Zero **Fix** / rule chat; OpenLoomi memory write-back on Skip | `learning-loop.ts`: `narrow` / `widen` / `new` proposals from override rates | `independent` |
| A rule overridden too often switches itself off | — (Inbox Zero surfaces per-rule history instead) | 20% override with ≥5 actions → auto-disable | `independent` |

### 2.4 Time, urgency, and things that slip

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Signals bucketed by how loudly they need you, with escalation over time | `mail-triage` (Now / Today / Later, quiet hours) | `escalateBy` + `escalation-checker.ts` promoting `seedling` → `active` | `independent` |
| Two-sided reply tracking: what I owe vs. what I am waiting for | Inbox Zero **Reply Zero** (`To Reply` / `Awaiting Reply`, follow-up reminders) | `signals.awaitingReplyAt` / `replyReceivedAt`, `reply.received` event, `awaiting` in the brief, `absorbedUnanswered` in the coverage curve | `adopted` (2026-11-18) |
| Commitments as stateful objects that a later message supersedes | OpenLoomi commitment lifecycle (`previousStates[]`, `supersededBy`, `currentDueDate`, `lastVerifiedAt`) | `packages/core/src/commitments.ts` and `thoughts.commitment`: verify or supersede per thread, append-only history | `adopted` (2026-11-18) |
| Surface uncertainty instead of resolving it silently | OpenLoomi "doubt interval" / `disputed` state | `thoughts.state = disputed` + `disputedReason`, set by `decide()` when a confident classifier is blocked | `adopted` (2026-11-18) |

The commitment gap was the one I considered a defect rather than a missing
feature: "I'll have it Friday" followed by "pushing it to Wednesday" left two
competing dates and no way to tell the first was dead. It is closed as of
2026-11-18 — the earliest `adopted` row in this file, and the one that changed
the data model rather than only the surface.

### 2.5 Privacy, storage, and the local boundary

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Local model by default, hosted only if chosen | MailTriage (llama.cpp); Aziru (Ollama); `smartmail` | `ai.json`, Ollama default, one documented egress path | `independent` |
| One process, one SQLite file, no server to run | `smartmail` (single Go binary); Pipe (Node + SQLite) | `better-sqlite3`, one Hono process on localhost | `independent` |
| Content redacted after a retention window, metrics kept | OpenLoomi forgetting engine / compaction | `retention.ts`, 30 days, `[redacted after Nd]` | `independent` |
| Credentials and per-account scope held in one revocable layer | Gatelet (self-hosted MCP proxy, YAML policy, encrypted creds) | each adapter holds its own OAuth; no shared policy layer | `rejected` — see §5 |

### 2.6 Cross-channel, and the attention framing

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Mail + SMS + calendar into one ledger of things that need a person | Pipe (WhatsApp/email/Telegram/Teams into one thread per person); OpenLoomi (email/calendar/GitHub/Slack/Linear) | `signals` + `thoughts` across gmail, outlook, gmessages, calendar | `independent` |
| Typed decisions with a confidence score, presented as cards | OpenLoomi Loop (`email_reply`, `rsvp`, `review_pr`… at 0.60–0.85) | `posture` + `ClassifierOutput.signalKind`; Thoughts are the card | `independent` |
| Read memory before judging, write the outcome back after | OpenLoomi Read → Judge → Write contract, per-card memory hooks | `directions` + `signals` are the only context a draft gets | `planned` |
| Morning brief *and* evening "what was handled for you" | OpenLoomi 9 AM to-do / 6 PM done | `/brief.handled` — absorbed, filed, sent, disputed, awaitingReply | `adopted` (2026-11-18) |
| No counts, no badges, no inbox | — (every project above is inbox-shaped) | extension has no badge or status-bar counter | `independent` |

### 2.7 Speech

| concept | nearest prior art | in `mind` | status |
| --- | --- | --- | --- |
| Local neural text to speech, so the spoken summary needs no cloud service | [Piper](https://github.com/OHF-Voices/piper1-gpl) (Open Home Foundation; voices in [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)) | `packages/server/src/piper.ts` runs the operator's installed `piper` as a child process, text on stdin, WAV out | `adopted` (2026-11-21), as an external program only |
| Speed as a length-scale multiplier, tone as noise and noise-width scales | Piper CLI options (`--length-scale`, `--noise-scale`, `--noise-w-scale`) | `piperArgs()` maps the Speed and Tone settings onto them | `adopted` |

## 3. Projects, by what they are good at

- **Inbox Zero** — `github.com/elie222/inbox-zero`, AGPL-3.0 (`apps/web/ee`
  commercial). The mature version of the email half: Gmail + Outlook, plain-English
  rules with Test/History/Fix, drafting in your voice, Reply Zero, bulk
  unsubscribe, real analytics, self-host or hosted, Ollama and
  OpenAI-compatible endpoints. If the goal were only "less time in my inbox",
  this is the answer and `mind` is a re-implementation.
- **OpenLoomi** — `github.com/melandlabs/openloomi`, Apache-2.0. The closest
  thing to the *framing*: a local-first attention agent with typed decision
  cards, approve-before-action, an audit log, and a memory layer with temporal
  validity. Read `openloomi.ai/docs/{loop,memory,attention-agent}` — the concepts
  are more useful than the implementation.
- **smartmail** — `github.com/DatanoiseTV/smartmail`. Best reference for an
  explainable audit trail and undo in a small self-hosted tool. Licence not
  checked; reference only.
- **MailTriage** — `github.com/dmarchevsky/gmail-triage`. Best reference for
  default-safe dry-run and a single-mailbox local model.
- **Aziru** — `github.com/aziruhq/aziru`. Nearest to this repo's safety posture:
  read-only connections, drafts that require approval, never auto-sends.
- **mail-triage** — `github.com/cosmoslab58/mail-triage`, MIT. Urgency buckets,
  quiet hours, and learning from a sliding window of corrections.
- **mail-sorter** — `github.com/burnoutberni/mail-sorter`, AGPL-3.0. Rules first,
  LLM as fallback, dry run by default.
- **Local-Email-Triage-Agent** — `github.com/claudiogiu/Local-Email-Triage-Agent`.
  LangGraph + Ollama with explicit human approval gates: the same architecture in
  Python.
- **Zero / Mail-0** — `github.com/Mail-0/Zero`. Open-source AI mail client, if the
  question is UI rather than pipeline.
- **Pipe** — `github.com/azweig/pipe`. Multi-channel inbox + AI second brain,
  one thread per person, drafts in your voice, SQLite. Closest on "several
  channels, one person, local".
- **Open Assistant** — `github.com/open-assistant-org/open-assistant`,
  BUSL-1.1. Broad connector coverage, but conversational, which `mind`
  deliberately is not.
- **Gatelet** — `github.com/hannesill/Gatelet`, MIT. Self-hosted credential and
  policy proxy for agent access to Gmail/Outlook/Calendar.
- **mautrix-gmessages** — `github.com/mautrix/gmessages`, AGPL-3.0. The
  Matrix ↔ Google Messages bridge that the `gmessages` adapter talks to. A
  runtime dependency of the deployment, not of this source tree.
- **Huginn** (MIT), **Activepieces** (MIT core), **n8n** (Sustainable Use, not
  OSI), **Node-RED**, **Windmill** — the general monitor → rule → act plumbing.
  Useful to gauge how much of this is commodity; deliberately not adopted (§5).

## 4. Observed, deliberately not adopted

- **A chat interface.** Inbox Zero and OpenLoomi both have one. `mind` is
  prompt-free by design; adding chat makes it the thing it is arguing against.
- **Inbox reorganisation** (labels, archive, unsubscribe, bulk clean-up). This
  reduces the *displayed* count, not the attention cost. It is also the part of
  Inbox Zero that is hardest to match, so competing there is a losing trade.
- **A rule-editing UI.** Directions are YAML in git because a policy diff should
  be reviewable, portable, and revertible; a database row edited through
  checkboxes is none of those.
- **Custom decision-type and channel registries** as data (OpenLoomi's
  `custom-types.json` / `custom-channels.json`). The adapter contract *is* the
  extension point here; a second registry would duplicate it.
- **Embeddings and a memory graph** for now. `PLAN.md` defers FTS5 to P6 and
  prefers retention over accumulation. A `people` lookup would buy most of the
  drafting benefit for a fraction of the surface.
- **A shared credential/policy proxy** (Gatelet). Correct for a multi-tenant
  service; here the adapters are in-process and the OS user is the boundary.

## 5. Licences

Concept overlap is not a licence problem; copied code would be.

- AGPL-3.0 projects (Inbox Zero, mail-sorter, mautrix-gmessages): read for
  behaviour, never pasted. `mind` is BSD-3-Clause and must stay free of AGPL
  code. `mautrix-gmessages` runs as a separate service behind Matrix, so the
  bridge is a deployment dependency rather than linked code — if that ever
  changes to vendoring or bundling, revisit it.
- Piper (`OHF-Voices/piper1-gpl`) is GPL-3.0. It is an external program the
  operator installs; `mind` runs it as a separate process and contains none of
  its code, the same boundary as `mautrix-gmessages`. Do not vendor, bundle or
  link it. The voice files it uses carry their own licenses (see each voice's
  model card in `rhasspy/piper-voices`); `mind` downloads one only when the
  operator names it and leaves automatic download on.
- BUSL-1.1 (Open Assistant) and n8n's Sustainable Use License are not open
  source in the OSI sense. Reference only, no code, no dependency.
- `npm run license:check` audits the lockfile; this file covers the ideas in it.

## 6. Maintenance

Add a row when a concept is ported, and change `planned` to `adopted` with the
date and what changed. If a borrowed mechanism turns out to be a bad fit, move
it to §4 with the reason — a rejected idea recorded once is worth more than the
same debate twice.
