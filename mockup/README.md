# mind extension mockup — work queue redesign

An interactive, self-contained HTML/JS mockup of the VS Code extension UI,
built around a single, re-sortable **Work Queue** instead of separate
Thoughts/Review trees. No build step, no server, no VS Code required.

All data is fake (`data.js`) and all state changes are local to the page
(`app.js`). Nothing here calls the real `mind` HTTP API.

## What changed from the first draft, and why

The first draft modeled one thing: an inbound message gets a drafted reply,
you approve or discard it. Real feedback moved the model in three ways:

1. **The daily plan and the daily brief are the same view.** "Today's Plan"
   is what the Work Queue looks like at the start of the day; as you act on
   items, it becomes the record of what happened. There's one ordered list,
   not two disconnected panels.

2. **Not everything is a message.** A work item can be a multi-stage AI
   pipeline — implement a ticket, run tests, do an adversarial self-review —
   where your job is reviewing the *evidence of work* (confidence score,
   stage pipeline, what the adversarial pass flagged), not approving a reply.
   If confidence is high enough and the direction allows it, this never
   reaches you at all. If it's low, or the direction still requires sign-off,
   you see exactly what was tried and why, then approve the PR (AI takes it
   from there to deploy), ask for more testing, or send it back.

3. **Urgency is a live score, not a one-shot deadline.** A P1/outage is a
   distinct item kind (`escalation`) that pins to the top of the queue
   unconditionally — this is the one case where interruption is correct and
   intended. Everything else carries an `urgencyScore` and can be viewed
   sorted by urgency or grouped by thread ("natural flow") via the toggle
   at the top of the queue.

4. **Your own outgoing questions get the same restraint the inbox gets.**
   The Outbox (bottom of the side bar) holds questions you've raised for a
   colleague. AI pre-checks each one against what you already have — "you
   may already know this, check config/billing.yaml" — and holds anything
   genuinely worth asking for a batch send, so a colleague isn't interrupted
   every two minutes regardless of whether they're also buffering their own
   replies to you.

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

## What you can do

- **Work Queue** (side bar, top) — one list, sorted by urgency by default.
  Click **⚡ Urgency** / **🧵 Flow** to toggle between priority order and
  thread-grouped order. 🔥 escalations are always pinned first regardless
  of sort mode.
  - Click a **🔍 review** item to open its full detail: a stage pipeline
    (Implement → Tests → Adversarial review → Human review → Open PR),
    a confidence badge, the adversarial reviewer's notes, and three real
    actions — approve (opens the PR, AI continues to deploy), request more
    testing, or send it back to AI for another pass.
  - Hover a **✉ reply-draft** item for inline ✓/✕, or click through for the
    same choice with the full draft visible.
  - Click a **🔥 escalation** to see why it bypassed everything else, then
    acknowledge it.
- **Your Questions (Outbox)** (side bar, bottom) — click a question to see
  AI's pre-check verdict. Mark it ready, drop it (AI saved you an
  interruption), or batch-send everything marked ready in one action.
- **Today's Plan** — click "Open Today's Plan" on the welcome tab. Groups
  by escalations / AI work awaiting review / drafts awaiting approval /
  questions ready to send / directions in effect / learning-loop proposals,
  with working Accept/Reject on proposals and a batch-send button.
- **AI provider badge** (status bar, bottom right) and **pause/resume
  badge** work the same as before.

## Relationship to the real extension

This is further ahead of the real `extension/src/*.ts` code than the first
draft was — the work-queue model, review-pipeline detail view, and outbox
do not exist in the real server or extension yet. Treat this as a proposal
for where those should go, not a preview of something already built.
