# Requirements — review queue extension

## Introduction

The VS Code extension is the only client. It is a view onto the local server,
never a decision-maker: it displays what the server recorded and sends explicit
operator intents back. No badge counts, no status-bar counters, no notifications.

## Requirement 1 — Queue is the only place a send is authorized

**User story:** As the operator, I want one screen where I approve or discard
drafted actions, so that a send is always an explicit human act.

**Acceptance criteria**

1. WHEN the Queue opens THEN it SHALL list `proposed` actions, one line each.
2. WHEN I approve an action THEN the extension SHALL call
   `POST /actions/:id/send` and refresh the list.
3. WHEN I discard an action THEN the extension SHALL call
   `POST /actions/:id/discard`, which records an override event.
4. WHEN a send is refused (pause flag, gate, failure) THEN the extension SHALL
   surface the server's message and leave the action in place.

## Requirement 2 — Thoughts and Signals stay inspectable

**User story:** As the operator, I want to open a Thought or a signal and see the
evidence behind it, so I can judge without trusting a summary.

**Acceptance criteria**

1. WHEN I open a Thought THEN its body SHALL open as a markdown editor.
2. WHEN the Signals view opens THEN it SHALL default to today and offer
   `today | 7d | 30d | all`.
3. WHEN I reclassify a signal THEN the extension SHALL PATCH it to a different
   Direction and log a `signal.reclassified` event, distinct from an override.
4. WHEN I open the Journal THEN it SHALL be read-only.

## Requirement 3 — Analytics and Devices webviews

**User story:** As the operator, I want the day's state and the numbers behind it
in one click, without a dashboard I have to maintain.

**Acceptance criteria**

1. WHEN I click an Analytics row or bar THEN it SHALL open the signals behind that
   number below the chart.
2. WHEN the Devices view opens THEN it SHALL say pairing is not implemented; it
   SHALL NOT pretend to pair.

## Requirement 4 — Local-only connectivity

**User story:** As the operator, I want the extension to talk only to my machine,
so that a misconfigured URL cannot leak tokens or message bodies.

**Acceptance criteria**

1. WHEN the extension starts THEN it SHALL read the bearer token from
   `~/.config/kIiYOSJe/mind/token` unless `mind.tokenPath` overrides it.
2. WHEN a webview renders THEN it SHALL use a strict CSP with a per-render nonce
   and no remote scripts, styles, or fonts.
3. WHEN `mind.serverUrl` points anywhere but loopback THEN the extension SHALL
   refuse to send the token.

## Requirement 5 — Provider configuration without a restart

**User story:** As the operator, I want to switch model providers from the editor,
so that a local model and a cloud model are one command apart.

**Acceptance criteria**

1. WHEN I run `mind.ai.configure` THEN the extension SHALL write the provider,
   model names, base URL, and key through `PUT /admin/ai-config`.
2. WHEN the key is left blank THEN the existing configured key SHALL be kept.
3. WHEN the provider changes THEN no server restart SHALL be required.

## Requirement 6 — Goals, and a summary I can read or hear

**User story:** As the operator, I want to name what I am focusing on and have
the Queue organise itself around it, and to get the day's plan as text or as
speech, so the Today screen is not needed.

**Acceptance criteria**

1. WHEN the Queue opens THEN it SHALL show Goals (Thoughts in the `goal` state)
   in one column and the items not linked to a goal in the other.
2. WHEN I drag an item onto a goal THEN it SHALL be linked to that goal, and
   Unlink SHALL undo it.
3. WHEN a new item reaches the Queue and automatic linking is on THEN the model
   MAY link it to a goal, and it SHALL do so only when its confidence is at
   least the configured threshold and the goal exists. Each automatic link
   SHALL be recorded as an event with `auto: true`.
4. WHEN a goal's deadline has passed or its review is due THEN the Queue SHALL
   say so on the goal and in the strip at the top.
5. WHEN I press Transcript THEN it SHALL show the summary text, and WHEN I press
   Audio THEN it SHALL play that same text rendered locally by Piper in the
   configured voice, speed and tone.
6. WHEN Piper is missing, a voice is missing and downloading is off, or Piper
   fails THEN Audio SHALL show the reason and SHALL NOT fail silently.
7. WHEN a voice must be downloaded THEN it SHALL come only from the
   `rhasspy/piper-voices` repository, only if "Download voices" is on, and the
   voice name SHALL be validated so it cannot select another path or host.
