# mind — build brief
  
## What it is
 
A personal assistant for one person's working life. It reads the streams where work
already happens — mail, chat, calendar, issue trackers, repositories, documentation —
decides what actually needs that person, drafts the reply or the next step, and then gets
out of the way. It tells the person what their day looks like, in text and in audio, and
it answers questions about their own work with citations.
 
The person uses it from their editor and from their phone. Both see one mind, not two
copies of one.
 
## Principles
 
- **Local-first.** The person's data lives on their own machine. The only thing leaving it
  is what is sent to a model provider they chose.
- **Drafts, not sends.** Nothing is sent, filed, or changed in a real system without an
  explicit human act, unless a policy the person wrote says otherwise.  Correction, as the system's knowledge increases, so too should its confidence in answering or accepting information as knowledge meaning more signals are directly absorbed.  Additionally, workflows such as development (hey can you pick up this jira to build xyz can be done more completely end-to-end with less direct involvement from me).
- **Traceable.** Every statement points at the item it came from. Every action lands in a
  journal that can be read as a timeline.
- **One person, many devices, one state.** Settings, queue, journal, and knowledge belong
  to the person, never to a client.
- **Fails small.** A lapsed sign-in, a down provider, or an unreachable server degrades one
  capability and says so in plain language; it does not take the rest with it.
- **Plain text where possible.** Policies, journal, notes, and exports are readable without
  a special tool.
 
---
 
# Foundations
 
These come first. Everything later depends on them, and none of the later features are
worth building on top of a missing foundation.
 
**1. Intake.** A connector contract every source implements: produce items with a source,
participants, a timestamp, a body, and thread identity; deduplicate repeats; normalise
formats. A source that is down or unconfigured contributes nothing and blocks nothing.
 
**2. Policies.** Rules the person writes, per sender, thread, or source, describing what
should happen to matching items — absorb silently, surface for attention, or draft a
response — with a confidence threshold and an escalation time. A catch-all policy covers
whatever no authored policy matches, with a sane default rather than a drop.
 
**3. Decisions.** Every item ends in one of three states: absorbed, needing attention, or
drafted. Escalation deadlines are derived from urgency and are visible; overdue items are
called out.
 
**4. The review queue and capture.** The editor shows drafts awaiting approval with their
full text, and a way to capture a thought in one keystroke.
 
**5. The journal.** An append-only record of everything mind did — absorbed, proposed,
sent, failed, rendered, policy changed — with the actor, the time, and enough detail to
explain it. Readable as a timeline and exportable as text.
 
**6. Settings, per person.** Brief time, voice and rate, which connectors are on,
notification choices, model provider. Written once and read by every client.
Notification choices include a configurable quiet period — a day-of-week and
time-of-day window (default Mon–Fri, 08:00–15:00, person's local time) outside
of which nothing is sent to notify the person, even though ingestion, matching,
and drafting keep running. This is distinct from asking for a notification
right now (an explicit, one-off act) — the quiet period only constrains the
system's own unprompted notifications.
 
**7. Retention and backup.** Item bodies are redacted after a window the person sets;
everything is backed up and restorable.
 
**8. A text brief.** A daily summary of what arrived, what was absorbed, what needs the
person today, and what is overdue.
 
**Done when:** a message from a configured source becomes an absorbed item, a surfaced item,
or a draft without intervention; the draft waits for approval; the event appears in the
journal; the daily brief is produced at the configured time.
 
---
 
## 1. Real connectors
 
Working connections to the accounts the person actually uses.
 
- **Microsoft Teams** — read recent conversations and channel history, and keep reading so
  the knowledge base stays current; send a reply or a new message.
- **Outlook mail** — read the inbox, threads, and attachments; draft, then send a reply.
- **Gmail** — the same, for a Google account.
- **SMS / Google Messages** — read message threads; send a reply.
- **Calendar** — Google Calendar and plain iCal feeds; read upcoming events and create one.
 
Every connector, in all cases:
 
- is enabled per account from a client, without editing files by hand;
- backfills meaningful history on first connect, so the knowledge base starts useful;
- reports its own health — connected, expired, erroring — with the action to take;
- fails alone;
- respects retention and redaction;
- drafts by default; sending is a separate, explicit act.
 
**Done when:** with credentials configured, a new message in any connected account becomes
a decision within a few minutes, a draft can be sent from the review queue, and
disconnecting one account leaves the others running.
 
## 2. Android app
 
The phone is a first-class client, not a viewer.
 
- Capture a thought in one gesture, with or without dictation.
- Read the brief and play its audio version.
- Read a draft, edit it, send it, or discard it.
- Ask for work and watch it progress to a result.
- The journal as a timeline, filterable by kind and time.
- Settings: brief time, voice, connectors, notifications.
- Pair with the editor by scanning a code; see and revoke devices from either side.
- Offline behaviour that is honest: the last brief and journal remain readable, captures
  queue, and stale data is labelled as stale.
 
**Done when:** a phone is paired from the editor in under a minute, and capture, brief,
review, and ask all work without the editor open.
 
## 3. Documentation and knowledge crawlers
 
- **Confluence** — crawl the spaces the person can see, keep up with edits, and index
  pages, attachments, and comments.
- The same contract admits further sources later without restructuring.
- Honour access: nothing from a page the person cannot open may surface anywhere.
- Skip unchanged pages; remove material that disappeared or that the person asks to forget.
- Recognise the reusable "how we do this here" notes — runbooks, checklists, decision
  records — and make them findable as such.
 
**Done when:** "how do we rotate the production database credentials" returns the current
runbook with a link to the page it came from.
 
## 4. Development workflow
 
Cover the tools a working engineer checks every day.
 
- **Jira** — issues assigned to me or mentioning me, blocked work, stale items; read an
  issue and its comments; draft a comment or a status update.
- **Git — GitHub, GitLab, Bitbucket** — pull requests waiting on my review, comments on my
  changes, failing checks on my branches, merge conflicts, stale review requests.
- **CI — Jenkins and GitHub Actions** — failures on my branches, flaky runs, and a short
  explanation of why a run failed with a link to the log.
- **Code review** — review a change against the repository's own conventions and its past
  review comments, pointing at the specific line and rule.
- **"How do I do X here"** — answer from docs, past pull requests, chat, and tickets, with
  sources.
 
**Done when:** a failed build or a review request on my work appears as an item needing
attention within minutes with a drafted next step, and a how-to question about a repository
gets an answer that cites where it came from.
 
## 5. Several clients, one person
 
- Pair a device by scanning a code shown in the editor. Each device has its own credential.
- Choose what each device may do — read, capture, send, render, change settings — and
  default a new phone to the least it needs. Revoke or rotate a device on its own,
  effective immediately.
- Settings, queue, brief, journal, and knowledge belong to the person, not the device: a
  change on the phone appears in the editor and the other way round.
- One server owns that state. No client keeps a private copy of anything shared.
 
**Done when:** I change the brief time on the phone and the editor shows it; I revoke the
phone from the editor and the phone is locked out on its next call; both clients tell the
same story in the same order.
 
## 6. Morning briefing
 
- A text brief at the time I choose: what arrived, what was absorbed without me, what needs
  me today, what is overdue, and the plan for the day.
- The same brief as audio, in a voice I picked, playable on the phone and in the editor and
  downloadable.
- Audio states its length and when it was rendered. New material marks it out of date, and
  re-rendering is one action.
- Voice, rate, delivery time, and length are shared settings, so every client agrees.
- Notify when it is ready; a missed brief is still waiting when I open a client.
 
**Done when:** I set a time, get both versions at that time, and a brief rendered before an
overnight arrival is clearly marked stale.
 
## 7. Knowledge base
 
The memory that makes sections 1, 3, and 4 worth having.
 
- A durable, searchable record of ingested conversations, documents, tickets, and code.
- Natural-language questions from either client, answered with citations to the exact
  items and dates. No answer without a source.
- Summaries: what happened in this thread, this project, or this person's week.
- Record who knows about a topic, based on who actually discussed or changed it.
- Freshness: new material searchable within minutes; edits supersede old statements.
- Forget on request: removing a source removes it from retrieval and from answers, and the
  removal is journalled.
 
**Done when:** a question about last month's decisions gets an answer pointing at the
messages, pages, or commits behind it, and forgetting a source makes it unretrievable.
 
## 8. Guidance and requests
 
Let me ask for work instead of only receiving it.
 
- Ask for something from any client. It becomes a request in a queue that the machine able
  to do the work picks up, and the result returns to the client that asked.
- Requests show their state honestly — waiting, running, done, failed, cancelled — and
  nothing is reported done unless the worker that did it said so.
- Results are journalled and, where they produce writing, arrive as a draft in the review
  queue rather than being sent.
- A request can name the policy or thread it concerns, so the result lands in the right
  place.
 
**Done when:** I ask my phone for a reply to a thread, watch it move from waiting to done,
and find the draft waiting for approval in the editor.
 
## 9. Learning and control
 
- Proposals come with evidence and a reason: this policy was overridden four times out of
  ten, here is the change that would fix it.
- Accepting a proposal is an edit I make; nothing is applied silently, and the edit is
  journalled.
- A policy overridden too often is switched off automatically, with a warning first and a
  one-click restore.
- I choose the model provider — local or hosted — per person, can change it without a
  restart, and can see which model produced a given item or draft.
- One view shows connector health, the request queue, the last brief, storage use, and
  recent failures, each with the action to take.
 
**Done when:** I can see why mind suggested narrowing a policy, accept it, and watch the
next week's decisions follow the new rule.
 
## 10. Running it
 
- A demo or replay world with seeded people and history, runnable beside the real one, so
  the product can be shown and tested without touching personal data.
- Retention, redaction, and backup cover everything new: knowledge base, journal, audio.
- Exports that a person can read and keep without mind installed.
 
---
 
## Order of work
 
1. Foundations, plus the demo world — nothing later can be tested without them.
2. Connectors and the knowledge base (1, 3, 7).
3. Development workflow (4).
4. Multi-client access and shared state (5).
5. Brief in text and audio (6), then the phone app (2).
6. Requests (8), then learning and control (9).
7. Operations (10) throughout, not at the end.
 
## Definition of done
 
- Every capability above is covered by tests that run in CI without a person clicking
  anything.
- No credentials, tokens, or personal content are committed anywhere.
- Clients stay usable when a connector, the model provider, or the server is unavailable,
  and say so in plain language.
- The documentation describes each capability from the person's point of view, not the
  code's.
 
## Out of scope
 
Multi-tenant or team-wide deployment, autonomous sends without approval, and platforms
beyond the editor and the phone.
