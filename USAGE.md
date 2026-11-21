# Using mind

How each screen works. The screens themselves carry no instructions; this file
does. Setup and configuration are in [README.md](README.md).

Open a screen from the **mind** icon in the Activity Bar.

## Queue

Two columns.

- **Goals (left).** A Goal is a Thought you have decided to focus on. Type a
  name in the box and press Enter or **Add**. **Done** closes a goal and **Park**
  sets it aside. A goal shows a flag when its deadline has passed or its review
  is due. **+ Sub-goal** adds a goal under it; sub-goals are indented below
  their parent and can have sub-goals of their own.
- **Not linked to a goal (right).** Everything awaiting action that is not
  linked to a goal. The tabs (Today, Upcoming, Backlog, All) are your plan for
  the day. The **Filter signals** box narrows the current tab to items that
  contain every word you type, in any text the item shows (channel, sender,
  summary, timing, Direction, draft, plan, age). Escape clears it.

The two columns scroll separately.

Each item is two lines: the channel, sender and when it needs you, then its
summary. Click the first line to open the item and see its draft, the reason it
is timed that way and its actions. **Details** shows the conversation, the
thought and the history. Approving a drafted reply here is the only place a send
is authorized.

### Linking items to goals

- Drag an item onto a goal or a sub-goal to link it.
- **Unlink** on a linked item undoes it.
- New items can be linked automatically; see [Auto-link](#auto-link).

### Selecting several items

Selection follows the usual list conventions.

| Action               | Result                                                            |
| -------------------- | ----------------------------------------------------------------- |
| Click                | Clears the selection and opens or closes that item                |
| Ctrl/Cmd+click       | Adds or removes that one item                                     |
| Shift+click          | Selects every item between the last item you clicked and this one |
| Ctrl/Cmd+Shift+click | Adds that range to the current selection                          |
| Esc                  | Clears the selection                                              |

When anything is selected, a bar appears above the list. Use it to plan the
selected items for Today, Tomorrow or the Backlog, or to link them to a goal from
the **Link to goal** list. You can also drag any selected item: the whole
selection moves onto a goal or onto the Today or Backlog tab.

### Planning and order

- Drag a single item up or down to reorder; Alt+Up and Alt+Down move a focused
  item.
- Drop an item on the **Today** or **Backlog** tab to plan it. **Plan…** on an
  item picks a date.
- Unplanned items that are due today or overdue are offered as one click:
  **Add them to today**.

### Transcript and audio

**Transcript** shows the day's summary as text: your goals and what is linked to
each, how many items are waiting and how urgent, the most pressing ones, and how
many messages were handled without reaching you. **Audio** plays that same text.
See [Audio summary](README.md#audio-summary-piper) for setting up Piper. If audio
cannot be made, the reason appears next to the button.

## Auto-link

When a new item reaches the Queue, the model may link it to one of your goals. It
links only when its confidence is at least the threshold in **Settings** (default
0.8). Below that the item stays unlinked for you to place. Every automatic link is
recorded in System Events as `signal.thought_linked` with `auto: true`, and
**Unlink** undoes it. Turn it off in Settings.

How it chooses: the app first shortlists the three goals whose title, parent
title, notes and hand-linked messages share the most words with the message.
A goal gets extra weight when you have already linked a message from the same
sender to it, and a lot when the same thread is already linked to it. Only those
three go to the model, each with the subjects of up to two messages you linked
there by hand (never their senders or bodies). If no goal shares a word with
the message, the model is not called and the item stays unlinked. Links the
model made on its own are never used as examples.

How well it works: `GET /metrics` has an `autoLink` section with the number of
automatic links in the window, how many you later unlinked or moved to another
goal (`corrected`), and the `rate`. Lower is better. It only counts mistakes you
noticed and fixed.

## Signals

Every signal, inbound and outbound. It defaults to today; use the range buttons to
widen it. Click a row to open the signal. **Reclassify** moves a signal to a
different Direction when the match was wrong.

## Directions

The rules mind matches signals against. Click a name to open its detail screen,
use the switch to enable or disable it, and click the handled count to see the
signals behind it. Fields can be edited in place. New Directions are written as
YAML under `directions/` (**mind: Edit Directions**).

Every edit is written back to that YAML file, so the policy stays reviewable in
git. The detail screen's **Preview** buttons answer "what would this rule have
caught?": they run the saved rule over up to fifty recent stored signals and show
what would match, what fell through to the catch-all, and what would trip a
guard. **Preview matches** does not call the model; **Preview with classifier**
also asks it about up to ten matches, giving each a confidence and saying whether
it would escalate or need you. A preview writes one `direction.previewed` event
and nothing else — no signal, thought or action is changed.

## Learnings

Narrow and widen proposals. They are rule-based: a periodic pass counts how often
drafts were overridden against approved unedited, and proposes a change only when
that rate crosses a fixed threshold. A model is asked afterwards for a short
explanation, shown as an Insight, but it never decides a proposal. The
reclassification log lists signals moved to a different Direction after the first
match.

## Analytics

The last 7 days, in one place. Every number is paired with a comparison: the
ratio is signals per Thought, and the target is the absorb rate the thesis has to
reach (60%).

The **Coverage** curve comes first because it is the claim: absorb rate per week
plotted against the number of Directions in force that week. Only explicit
Directions count — the catch-all is excluded, and the caption says how many
signals that left out, so the rate cannot rise just because more traffic fell
through to a rule that matches everything. A dashed line marks the target, a
dotted stepped line shows Directions, and yellow bars under the axis are signals
that were absorbed but never answered. A week with no traffic is a gap in the
line, not 0%. Click any week to list its signals below.

The **Flow** diagram shows where signals went: channel on the left, the Direction
that matched in the middle, and the outcome on the right (absorbed, filed,
surfaced, escalated). A line's thickness is how many signals took that path, and
the dashes move along it. Hover a node or line to highlight its path and see the
numbers. Click a node or a line to list its signals below, and click a row to open
the signal. "Other" nodes group the smallest channels or Directions and cannot be
opened. The Direction table and the daily volume bars below it open their signals
the same way.

## Journal

Your own dated notes. They are appended automatically with a date and are not tied
to any signal or Direction.

## System Events

What mind itself did, in order: matching, classification, drafts, sends and every
decision between. Click a column header to sort, and click it again to reverse.
The Detail column is a one-line preview of the event's JSON; click it to expand
the full payload.

## Model Trace

A graph of every model call, drawn from the audit log.

- **Reading it.** The steps run left to right: Signal, Match, Classify, Transform,
  Draft, Link to goal. The lines under them go to the model that
  served that step. A thicker line is more calls, a faster flow is lower latency,
  and a red line has failures. A dashed empty node means no model was called in
  that range. Boxes grow to fit their text.
- **Where signals went.** Green boxes in a row under the model show where the
  processed signals ended up: **Queue**, **Absorbed**, **Filed**, or a **goal**
  (the goal the signal is linked to now). The three goals with the most signals
  get a box each; the rest are grouped as "N other goals". A thicker line is
  more signals. A signal that is no longer stored, or was not linked, is counted
  under its outcome instead.
- **Hover** any node or line for its numbers.
- **Click** a node or line to list the records behind it below the graph, the way
  Analytics does. Model steps and models list their calls; Signal, Match,
  and the green boxes list the processed signals, with a "Went to"
  column. Click a row to open the signal. Click
  the node again, or **clear**, to remove the filter.
- **Replay** animates the last 40 matching calls. **Live** polls every few
  seconds and animates new calls as they arrive.
- **Check Ollama** asks a local Ollama which models are installed and which are
  loaded in memory, and flags a model that recent calls used but is not
  installed. It only contacts localhost.

## Settings

- **Display:** which signal fields (subject, Cc, Bcc, HTML body) the Signal Detail
  screen shows by default.
- **Auto-link to goals:** on or off, and the minimum confidence from 0.5 to 1.
  Higher links less often and is wrong less often.
- **Audio summary:** voice, speed (0.5 to 2), tone (calm, neutral, upbeat), speaker
  number for multi-speaker voices, the Piper command, and whether a missing voice
  may be downloaded from huggingface.co. Gender is a property of the voice you
  pick. Each voice has its own license on its model card.

## Devices

The clients paired to this server, and pairing a new one.

**Paired clients** lists each device's name, kind, when it was paired, when it
was last seen, and its permissions. **Revoke** locks that device out on its next
request; every other client keeps working. A revoked row stays in the list so
the history is visible.

**Show pairing code** picks a name and permissions here, then shows a six-digit
code for ten minutes. Enter the code in the Android app (or any client that
speaks `POST /devices/pair`). The device receives its own token exactly once;
the server stores only a hash. The code works once, accepts five wrong tries,
and new phones default to `read` + `capture`.

Permissions mean what they say: `read` is every GET, `capture` adds a thought or
acknowledges a signal, `send` approves or discards a drafted reply, `render` is
the audio summary, and `settings` changes Directions, admin settings, goal links
and queue order. Device management itself needs the editor's own token, so a
lost phone cannot revoke the other clients.

The phone must be able to reach the server: start it with `MIND_BIND_HOST=0.0.0.0`
on a trusted network (the default binds only to `127.0.0.1`). See
[`android/README.md`](android/README.md).
