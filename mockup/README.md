
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

### Thoughts — the larger item a signal attaches to

A **Thought** is the ticket, issue, task, incident, or discussion a signal
is really about — `{ id, kind, title }`. For engineering work this is
almost always a ticket/issue/task; informational signals (an incident
writeup, a newsletter, an announcement) link to a plain thought instead. A
signal carries `thoughtId` pointing at one, and the picker used everywhere
("Link to a ticket or thought") lets you pick an existing one or type a new
title to create and link it inline.

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

## Chat exchanges

Chat signals are no longer flattened into a single absorbed line. The
detail pane for a chat shows both sides of the conversation — every message
in `exchange`, inbound and outbound — so you can see what was actually said
instead of just the AI's summary of it. A chat that references untracked
work and has no thought linked yet is treated as dangling (see above),
appears in the Queue, and gets explicit "Link to a ticket or thought" /
"Dismiss" actions instead of silently closing.

## Signal sources vs. signals

**Sources** are the connectors signals arrive through — an inbox, a Jira
webhook, a phone number, a Slack workspace — not signals themselves.
Configuring one wires up a channel; it doesn't create any data on its own.
The Signals toolbar's **Sources** button opens a list of configured sources
(toggle enabled/disabled, remove) and a small form to add a new one
(channel + label). This replaced an earlier "Add signal" button that
created fake test signals directly, which conflated "where signals come
from" with "a signal that happened" — two different concerns.

## Views

- **Queue** — a list/detail layout. The list is sorted by urgency by
  default (toggle to **Flow**, which groups by thread/ticket instead).
  Credential-gated escalations (red-tinted cards) always pin to the top
  regardless of sort; items with a pending background follow-through show
  disabled with a pulsing running badge instead of disappearing. Click any
  card to see the full detail on the right: the generic context renderer
  for review items, the editable draft for reply items, the OTP gate for a
  blocked triage, the link-or-dismiss prompt for dangling work, or a chat's
  full exchange — each preceded by the stated reason it needed you.
- **Today** — the same open items, grouped and summarized as a single
  page: what needs you right now, what AI work is waiting for review,
  what's drafted and awaiting approval, anything not yet linked to a
  ticket or thought, anything still running in the background, directions
  in effect, and pending learning-loop proposals with working
  Accept/Reject.
- **Signals** — every signal, inbound and outbound, every channel,
  resolved or not. Filterable by channel and direction, tagged with its
  linked thought (or "unlinked" if dangling). This is the evidence layer:
  proof of what the system actually absorbed versus what reached you,
  independent of the queue. Its toolbar carries the same pause/resume and
  AI-provider controls as the top bar, plus **Sources** to manage the
  connectors signals arrive through.

The AI provider chip and the pause/resume chip (top right, and mirrored in
the Signals toolbar) work as before.

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
the running-state badge, the AI usage budgets panel, or Signals'
schedule-row override exist in `extension/src/*.ts` or the real server
yet. The real server's `/signals` ingress endpoint and its five-table
schema (`signals`, `thoughts`, `actions`, `directions`, `events`) are a
reasonable starting point for the backing data model, but `context` and
`reason` as open-ended per-source payloads, the credential-handback
contract for `needs-credential`, a `runningState`/callback mechanism for
background follow-through, and the AI budget settings are all new and
would need their own schema decisions before implementing any of this for
real.
