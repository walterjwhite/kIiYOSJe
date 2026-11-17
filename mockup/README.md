
# mind — signal-centric mockup

An interactive, self-contained HTML/JS mockup, rebuilt around one object —
the **Signal** — instead of modeling special cases for different kinds of
work. No build step, no server, no VS Code required.

All data is fake (`data.js`); all state changes are local to the page
(`app.js`). Nothing here calls a real API.

## The model

Every inbound email, chat message, Jira update, calendar event, SMS, and
every outgoing message is a **Signal**:

```
{ id, channel, direction: "in"|"out", from, to, timestamp, summary, body, status, thoughtId, runningState }
```

A signal that still needs a decision also carries a `request`:

```
{ kind: "approve-send" | "external-review" | "needs-credential" | "needs-link",
  urgencyScore, threadKey, escalateBy, reason, context }
```

`reason` is always present on a `request` and is a short explanation of
*why the AI stopped and handed this to you* instead of resolving it on its
own — a direction's posture or autonomy setting, a confidence score under
threshold, a credential only you hold, or work that isn't tracked anywhere
yet. The AI always attempts to resolve a signal itself first; `reason` is
where it shows its work for why that didn't happen here. It's rendered as
a labeled block at the top of every gated signal's detail view.

`context` beyond that is **open-ended and source-defined**. For an
`external-review` signal — the Jira-ticket-to-PR case — `context` is
whatever the originating automation chose to report: a confidence score, a
list of stages, free-text notes, a list of changed files, a link back to
the ticket. The UI renders whatever is present and nothing it doesn't
recognize breaks the layout. A different source (a CI pipeline, a
monitoring tool) could report a completely different shape and it would
still render, because the detail pane walks `context` generically rather
than assuming Jira's structure.

**This UI does no work.** The Jira automation implements the ticket, runs
tests, and does its own adversarial self-review entirely outside this tool.
In the real version, that automation calls an ingress endpoint (`POST
/signals`, already in the real server) to create the signal and attaches
its own context; approving the item in this UI calls back out to whatever
endpoint the source system expects, handing control back to it. This mockup
fakes that round-trip with a toast message instead of a real HTTP call.

Signals with no `request` already happened — a calendar invite that
auto-accepted, a chat message that was purely informational, a reply that
already sent. They appear only in **Signals**, never in the Queue.

### When does a signal leave the Queue?

A signal stays in the Queue for as long as it owes you a decision —
including "no decision needed yet, something is still running in the
background." It leaves the Queue only once no decision is pending:

- **You make the decision and nothing follows it up** (discard, dismiss,
  approve a draft with no further send step) — closes immediately, moves
  to Signals.
- **You make the decision, but it kicks off background work** (providing
  an OTP that lets a triage resume, approving a send that goes out with
  the next batch) — the card stays in the Queue, in the same position,
  shown disabled with a pulsing `runningState.label` badge instead of
  disappearing. It leaves once the background work reports back: closing
  if nothing further is needed, or staying open with a new `request` if it
  needs you again.
- **Nothing to decide, ever** (an auto-accepted calendar invite, an
  informational chat with no linking need) — never enters the Queue at
  all; appears only in Signals.

The `s-1` OTP example and the `s-14` "already approved, sending with the
next batch" example both demonstrate the running state — try either one
and watch the card stay in place instead of vanishing.

**Changed your mind mid-flight?** Every running item's detail view has a
"Changed your mind? Pause this and edit" control. It cancels the pending
background-work timer, clears `runningState`, and puts the item back in
its normal open state with the same action buttons it had before — so
approving a send and then catching a mistake doesn't mean waiting for it
to go out and discarding the result; it means pausing it before it does.

### Thoughts — the larger item a signal attaches to

A **Thought** is the ticket, issue, task, incident, or discussion a signal
is really about — `{ id, kind, title }`. For engineering work this is
almost always a ticket/issue/task; informational signals (an incident
writeup, a newsletter, an announcement) link to a plain thought instead. A
signal carries `thoughtId` pointing at one, and the picker used everywhere
("Link to a ticket or thought") lets you pick an existing one, or type a
title and create a new ticket, issue, task, or thought on the spot — all
four kinds are offered so a quick-captured title doesn't force a kind
that doesn't fit, and the new one links to the signal immediately.

A signal that references work not yet tracked anywhere is **dangling** —
flagged `needsLinking: true` and, critically, given a synthetic
`request.kind: "needs-link"` so it shows up in the **Queue**, not only in
Signals. Earlier dangling chats only appeared in Signals, which meant they
were easy to lose entirely if you never opened that tab; now any signal
that owes you a decision — including "decide whether this is worth
tracking" — surfaces where you're actually looking.

### Needs-credential — AI-driven triage that hits a wall only you can clear

The `needs-credential` request kind models a triage that is already
running on its own (classifying the alert, pulling logs, checking recent
deploys, cross-referencing IPs — all done automatically) but hits a step it
cannot pass without a credential only the operator holds, such as an OTP
needed to open the prod audit trail. The detail view shows exactly what the
triage already did, states the reason it's gated on you, prompts for the
credential, and on submission marks the item `runningState` while the
triage resumes in the background, then reports the outcome and closes.

## Why there's no separate Outbox

Every outgoing message originates from a queue item, so a separate "sent
items" view for things you're about to send would just duplicate the queue.
Instead, approving an `approve-send` item shows a **schedule row** —
"Will send with the next scheduled batch" — with a one-click override to
send immediately. The outgoing signal itself still shows up later in
Signals, same as everything else, tagged with how it was actually sent.

## Views

- **Queue** — a list/detail layout. The list is sorted by urgency by
  default (toggle to **Flow**, which groups by thread/ticket instead).
  Credential-gated escalations (red-tinted cards) always pin to the top
  regardless of sort; items with a pending background follow-through show
  disabled with a pulsing running badge instead of disappearing. Click any
  card to see its detail, split into two tabs: **Action** (the generic
  context renderer, editable draft, OTP gate, or link-or-dismiss prompt —
  whatever this item actually needs right now) and **Work history** (what
  this one item is — channel, thread, matched direction, linked thought —
  and its own timeline pulled from `events`, pruned by retention).
- **Today** — the same open items, grouped and summarized as a single
  page: what needs you right now, what AI work is waiting for review,
  what's drafted and awaiting approval, anything not yet linked to a
  ticket or thought, anything still running in the background, directions
  in effect, pending learning-loop proposals, requests, knowledge search,
  connector health, and a link to Devices.
- **Signals** — every signal, inbound and outbound, resolved or not,
  described below. Search and filters are hidden by default behind a 🔍
  button (or Ctrl+F).
- **Directions** — a compact table (same pattern as Signals); click a row
  to open that direction's own screen and edit everything about it,
  described below.
- **Learnings** — the durable record behind those directions, described
  below.
- **Analytics** — volume, override rate, and estimated time saved, every
  row and bar clickable to drill into the matching signals, described
  below.
- **Journal** — append-only, operator-written notes, described below.
- **Devices** — paired clients and pairing a new one, described below.

The pause/resume chip, Demo data chip, AI provider chip, and Settings chip
live in the top bar only.

## Signals — one view, default to today, widen with a range selector

Earlier this was two tabs: **Signals** (current state) and **History**
(a separate permanent log). The split didn't earn its keep — a signal's
own row already reflects its live status, and nothing is dropped from
Signals when that status changes, so keeping a second, separate log
duplicated the same information without adding a distinction worth the
extra tab. **Signals** is now the one place: a segmented control
(**Today** / **7 days** / **30 days** / **All**) controls how far back
the list reaches, defaulting to **Today** so the common case — "what's
going on right now" — doesn't require scrolling through weeks of
resolved traffic. Search and the channel/direction filters stay hidden
behind the 🔍 icon (or Ctrl+F) for the same reason. Clicking any row,
regardless of status, opens that signal's own detail view — closed and
resolved signals open read-only (their Work History tab and, for chats,
the full exchange), not just a toast.

## Settings — budgets and retention, consolidated

The AI usage budgets panel and history retention live together in one
**Settings** panel (top bar). Retention doesn't belong as a button on a
list screen — it's a standing configuration choice, not something you
reach for while scanning signals — so it lives where the other standing
configuration already does.

## AI usage budgets — mockup of the future `mind.ai.*` VS Code settings
To prevent a runaway AI loop (a stuck triage, a model that won't stop
generating, a misconfigured retry) from burning time or money unbounded,
the real extension will eventually expose standard settings under
`mind.ai.*` in VS Code's Settings UI. This mockup previews them as a
**Budgets** panel (top bar and Signals toolbar, next to the AI provider
chip) rather than touching the real extension or server — nothing in
`extension/` or `packages/` changed for this; it's `mockup/data.js`'s
`aiBudgets` object plus a modal in `app.js`/`index.html`, exactly like
every other control in this file:

- `mind.ai.timeBudgetMsPerTask` — max wall-clock time for one AI call.
- `mind.ai.tokenBudgetPerTask` — max tokens for one AI call.
- `mind.ai.tokenBudgetPerDay` — max total tokens per rolling 24h day, with
  a live usage bar against today's simulated spend.
- `mind.ai.onBudgetExceeded` — `pause` (kill switch), `escalate` (surface
  as a signal needing you), or `notify-only`.

Saving in the mockup just updates `state.aiBudgets` and shows a toast — no
server call, same as the AI provider picker. Once this shape is confirmed,
the real version would declare these under `contributes.configuration` in
`extension/package.json` and push them to `~/.config/mind/ai.json` via the
existing `/admin/ai-config` endpoint, the same mechanism already used for
switching AI providers — but that wiring is intentionally not done yet.

## Directions — a table, a detail screen, and an actual prompt

Earlier, a direction was a name, a one-line description, and a few
sliders — not enough to tell AI how to actually recognize or handle
anything. The **Directions** tab is now a compact table (name, posture,
autonomy, confidence, signals handled); clicking a row opens that
direction's own screen with:

- Editable **name** and **description**.
- A **match prompt** — how AI decides a signal belongs to this direction
  at all (e.g. "match if the sender is on the PM distribution list AND
  the message asks for a status or ETA update").
- A **response prompt** — how AI should actually handle a match (e.g.
  "answer factually from the most recent known status; if unknown, say
  so rather than guessing a date").
- Posture, autonomy, confidence minimum, and send policy (batched times
  or immediate), same fields as before.
- Its own learnings (with a link back to the Learnings tab) and every
  signal currently matched to it, each with a **"Move to another
  direction"** reclassify action (see Learnings below).

Every signal's `reason` text already referenced posture/autonomy/
confidence; `matchPrompt`/`responsePrompt` are what would actually drive
those decisions for real, and now have somewhere to live and be edited.

### Learnings — how it actually works, and reclassification

Not a vector database, and nothing here is summarized by a model. A
periodic rule-based pass (`state.learningRuns` — shown as its own table:
when it ran, the window, how many directions and events it scanned, how
many proposals it emitted) scans `state.events` — every decision made on
every direction, inbound and outbound signals alike — counts how often a
draft was overridden vs. approved unedited per direction over a rolling
window, and proposes a narrow/widen only when that override rate crosses
a threshold (20% by default). `state.learnings` is the permanent record
of every proposal that pass has ever produced, accepted or rejected, with
its rationale and (for rejections) why. Every direction's own screen
reciprocally links to its learnings, so the relationship works in both
directions instead of only Learnings pointing at Directions.

**Reclassification** (`state.reclassifications`) is the correction path
for when the match itself was wrong — a signal's description confused the
matcher and it landed on the wrong direction. From a direction's "Signals
handled" list, "Move to another direction" opens a picker, moves the
signal's `directionId`, and logs the move with a reason; a Reclassifications
list at the bottom of Learnings shows every correction made this way,
and the direction screen shows any reclassification involving it, in
either direction.

## Analytics — throughput and time saved, fully interactive

Analytics shows volume by direction, volume by channel, daily volume, and
an estimated-time-saved figure — but every row and bar is also a way in,
not just a summary. Clicking a direction's row, a channel's bar, or a
single day's bar in the daily-volume chart opens a drill-down panel below
the chart listing exactly the signals behind that number, rendered with
the same row component the Signals tab uses (`renderSignalRows`), so a
drill-down row behaves exactly like a Signals row — click it and it opens
that signal's own detail view, same as anywhere else. There's no separate
read-only summary mode; every number here is a filter waiting to be
clicked.

## Journal — append-only, operator-written notes

A plain, append-only log of notes you write yourself — not generated,
not matched to a direction, not tied to any signal. It's a place for
observations that don't belong on a specific record ("the PM team seems
to be escalating more than usual this week") without forcing them into
a signal's context or a direction's description.

## Devices — paired clients, and pairing a new one

`state.devices` lists every client paired to this account — this mockup,
and eventually a real Android app. Each device shows its name, type,
last-seen time, and a `scopes` checklist (read / capture / send / render /
settings) controlling what that device is allowed to do; scopes default
to read + capture for a newly paired device, and can be changed or the
device revoked independently at any time, without affecting any other
paired device.

**Pairing** button generates a short-lived six-digit code
(`state.pendingPairing`) meant to be entered on the new device. Since
there's no real second device here, confirming pairing in this mockup
just simulates the handshake completing and adds a new entry to the
devices table — standing in for whatever real pairing protocol the
Android app will eventually use. Today's plan view links to this tab
instead of duplicating the devices list inline.

## Write a message — generic, AI-authored, scheduled like any other send

Every signal's detail view — open, running, or already closed — has a
"Write a message about this" link, on the Action tab. You describe the
goal ("find out whether the bypass needs a feature flag"), not the exact
wording; the AI drafts the actual outbound signal (shown once drafted,
after a short "AI drafting message" beat, same as any other background
step), and the draft goes through the same approve/discard flow as every
other reply — clicking **Write** doesn't send anything by itself, it
hands the draft to the normal review step. Before that, you choose when it
sends: the direction's **default** fixed batch time, **now**, or (only for
a real-time channel like chat/Teams) **when the recipient is next free**
(checked against their calendar). That third option only appears for
chat — email has no live presence the way a chat client does, so offering
"when they're free" there wouldn't mean anything; it disappears from the
dropdown the moment you switch the channel to email, both in the composer
and on an already-matched signal's own schedule control.

This is deliberately **not** modeled as an MCP tool-call or any kind of
agent-executes-arbitrary-actions integration — it's the same signal
envelope everything else uses, with the AI standing in as the author of
the first message. Once sent, a reply is simulated landing back on the
same thread as a new `exchange` entry, and the signal **reopens** with a
fresh `external-review` request instead of just closing, modeling the AI
still being present in that conversation rather than a one-shot
fire-and-forget message.

## Chat exchanges — multi-turn, and group chats as separate signals per topic

A real chat is rarely one message each way. `s-7` shows a full
back-and-forth (seven messages) before the original question is actually
answered, instead of a single exchange in each direction.

Group chats are a different shape: one room, multiple participants, and
often more than one unrelated conversation happening in it at once. An
earlier version of this mockup modeled that as *one* signal with two
`topicId`-tagged clusters inside it — which was wrong: two unrelated
topics in the same room are two different things that happened, not one
record with internal subdivisions. `#eng-platform` is now modeled as two
separate signals that happen to share a `room` field:

- `s-16` — a software engineer asks whether the rate-limit bypass is
  demo-safe; a QE, a PM, and a product owner all weigh in across several
  messages. This one concerns the operator directly, carries a `request`,
  and appears in the **Queue**.
- `s-17` — a different engineer starts an unrelated thread in the same
  room asking the QE about a flaky test. This one never involves the
  operator, carries no `request`, and **never appears in the Queue** —
  but it's still a real signal, visible as its own row in **Signals**,
  and clicking it opens its own conversation, never mixed with `s-16`'s.

## Signal sources, connector health, and demo data firers

**Sources** are the connectors signals arrive through — an inbox, a Jira
webhook, a phone number, a Confluence space, a GitHub repo, a CI
pipeline — not signals themselves. Configuring one wires up a channel; it
doesn't create any data on its own. Each source also shows a `health` tag
(connected/disconnected/erroring — TODO.md's "every connector reports its
own health... with the action to take") and the Signals toolbar's
**Sources** panel lets you toggle, remove, or add one.

Some sources carry a `firer`: a synthetic connector that, while the global
**Demo data** chip (top bar) is on and that source is enabled, periodically
generates a believable new signal — a PM asking for a status update, a new
Jira ticket, a chat ping — on a random timer within a configured window.
This stands in for TODO.md's real connectors (Teams, Outlook, Gmail, SMS,
Confluence, GitHub, CI) until those exist: once a real connector is built,
its `firer` can simply be removed, since real traffic replaces it. Demo
data is off by default so the mockup stays deterministic for a fixed
walkthrough, and on by choice for a "watch it run" demo.

## TODO.md coverage in this mockup (excluding Android)

Per TODO.md's foundations and later sections, this round adds a thin slice
of each, enough to be demonstrable without building a real backend for any
of them:

- **Journal** (Foundations #5) — its own tab, described above.
- **Settings, per person** (Foundations #6) — the AI Budgets panel, History
  retention, and a `briefSettings` block (time/voice/audio) shown read-only
  in Today, stand in for the shared settings TODO.md describes.
- **Connectors + health** (section 1) — `state.sources` now includes
  Confluence, GitHub, and CI entries with health status, plus the demo
  firers described above standing in for real connections.
- **Knowledge base** (section 7) — a small `state.knowledge` array and a
  search box in Today that only ever answers with a cited source, or says
  there's no match — "no answer without a source" from TODO.md, taken
  literally even at this small scale.
- **Guidance and requests** (section 8) — `state.requests`, shown in Today
  with honest status (waiting/running/done/failed/cancelled), separate
  from "Ask AI to reach out" (a request asks for *work*; Ask AI sends a
  *message*, though in the real system the first could produce the second).
- **Several clients, one person** (section 5) — the **Devices** tab,
  described above, including a simulated pairing flow with per-device
  scopes; standing in for the real device-pairing and shared-state model
  TODO.md describes, and for the eventual Android app specifically.
- **Morning briefing** (section 6) — `briefSettings` is shown, not
  rendered as an actual brief; Today already serves as the de facto daily
  summary this mockup produces.
- **Android** (section 2) — explicitly skipped per instruction; nothing
  here models a phone client.
- **Learning and control** (section 9) — already covered by Directions
  and Learnings, described above.
- **Several connectors' specific behaviors** (sections 3 and 4 — Confluence
  crawling, Jira/GitHub/CI specifics, code review, "how do I do X here") are
  represented only as source entries and a couple of knowledge-base rows;
  their actual behaviors are out of scope for a UI mockup and would need
  real backend work to mean anything.

## Open it

```bash
xdg-open mockup/index.html      # Linux
open mockup/index.html          # macOS
```

Or serve it if your browser blocks local `file://` script loading:

```bash
cd mockup && python3 -m http.server 8911
# then open http://localhost:8911
```

## Relationship to the real extension

This is a proposal, not a preview — none of the signal model, the generic
context renderer, the thought-linking picker, the needs-credential gate,
the running-state badge, the AI usage budgets and retention Settings
panel, the Directions table and per-direction detail screen with
match/response prompts, the Learnings history and learning-run log, the
reclassification mechanism, the interactive drill-down Analytics tab, the
Signals range selector, the Journal, the Write-a-message composer, the
demo data firers, the detail-pane Action/Work-history tabs, Signals'
schedule-row override, the group-chat-as-separate-signals-per-topic model,
or the Devices tab's pairing mechanism exist in `extension/src/*.ts` or
the real server yet. The real server's
`/signals` ingress endpoint and its five-table schema (`signals`,
`thoughts`, `actions`, `directions`, `events`) are a reasonable starting
point for the backing data model — the real schema already has a
`directions` table and an `events` table, which lines up well with this
mockup's `state.directions` and `state.events` — but `context` and
`reason` as open-ended per-source payloads, match/response prompts on a
direction, the credential-handback contract for `needs-credential`, a
`runningState`/callback mechanism for background follow-through, the AI
budget settings, a durable `learnings` record distinct from in-flight
`proposals`, a `reclassifications` log, a real journal table, and
whatever backs a real "write and schedule" flow are all new and would
need their own schema decisions before implementing any of this for real.
