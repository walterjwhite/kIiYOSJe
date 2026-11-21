# Using mind

How each screen works. The screens themselves carry no instructions; this file
does. Setup and configuration are in [README.md](README.md).

Open a screen from the **mind** icon in the Activity Bar.

## Queue

Two columns.

- **Goals (left).** A Goal is a Thought you have decided to focus on. Type a
  name in the box and press Enter or **Add**. **Done** closes a goal and **Park**
  sets it aside. A goal shows a flag when its deadline has passed or its review
  is due.
- **Not linked to a goal (right).** Everything awaiting action that is not
  linked to a goal. The tabs (Today, Upcoming, Backlog, All) are your plan for
  the day.

Each item is two lines: the channel, sender and when it needs you, then its
summary. Click the first line to open the item and see its draft, the reason it
is timed that way and its actions. **Details** shows the conversation, the
thought and the history. Approving a drafted reply here is the only place a send
is authorized.

### Linking items to goals

- Drag an item onto a goal to link it.
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

## Signals

Every signal, inbound and outbound. It defaults to today; use the range buttons to
widen it. Click a row to open the signal. **Reclassify** moves a signal to a
different Direction when the match was wrong.

## Directions

The rules mind matches signals against. Click a name to open its detail screen,
use the switch to enable or disable it, and click the handled count to see the
signals behind it. Fields can be edited in place. New Directions are written as
YAML under `directions/` (**mind: Edit Directions**).

## Learnings

Narrow and widen proposals. They are rule-based: a periodic pass counts how often
drafts were overridden against approved unedited, and proposes a change only when
that rate crosses a fixed threshold. A model is asked afterwards for a short
explanation, shown as an Insight, but it never decides a proposal. The
reclassification log lists signals moved to a different Direction after the first
match.

## Analytics

Volume, override rate and time saved. Click a Direction row, a channel bar or a
day bar to list the signals behind it below.

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
  Draft, Link to goal, Queue/absorb. The lines under them go to the model that
  served that step. A thicker line is more calls, a faster flow is lower latency,
  and a red line has failures. A dashed empty node means no model was called in
  that range.
- **Hover** any node or line for its numbers.
- **Click** a node or line to list the records behind it below the graph, the way
  Analytics does. Model steps and models list their calls; Signal, Match and
  Queue/absorb list the processed signals. Click a row to open the signal. Click
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

A placeholder. Pairing is not built.
