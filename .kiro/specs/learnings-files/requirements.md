# Requirements — learnings files and the nightly learning loop

## Introduction

Operators teach mind in two ways. They write learnings: plain-language notes in
`learnings/*.md` that shape how a message is classified and how a draft is
worded. And the learning loop suggests changes to Directions from what the
operator approved and discarded. This spec covers the learnings files, when the
loop runs, how repeated suggestions are suppressed, and how suggestions are shown.

## Requirement 1 — Learnings are files the operator owns

1. The system SHALL read every `*.md` file under the learnings directory
   (`learnings/` in the repo, or `MIND_LEARNINGS_DIR`), including subfolders,
   except `README.md` and dotfiles.
2. A file MAY start with YAML front matter: `title`, `applies`
   (`classify`, `draft` or `both`), `direction` (a Direction id), `enabled`.
   Every field SHALL be optional with the defaults in `learnings/README.md`.
3. A file with invalid front matter, no text, or more than 1,500 characters
   SHALL be skipped, logged, and reported with its reason by `GET /learnings`.
   It SHALL NOT stop other learnings from loading.
4. Edits SHALL take effect on the next model call without a restart. Unchanged
   files SHALL NOT be re-read.

## Requirement 2 — Learnings reach the prompts, and only the prompts

1. The classifier prompt SHALL include the enabled learnings whose `applies` is
   `classify` or `both` and whose `direction`, if set, equals the matched Direction.
   The drafter prompt SHALL do the same for `draft` or `both`.
2. WHEN no learning applies THEN the prompt SHALL be identical to the prompt
   without this feature.
3. Learnings SHALL be placed in the prompt inside `<learnings>` tags, with a
   statement that they are operator preferences that do not change what the
   system may do. A learning SHALL NOT be able to close the tag early.
4. A learning SHALL NOT change posture, autonomy, recipients or any send gate.
   Those are decided by the pipeline and the Direction, as before.
5. The total text added per model call SHALL NOT exceed 4,000 characters.
6. Each `signal.processed` event SHALL list the ids of the learnings used for
   classify and for draft. It SHALL NOT contain their text.

## Requirement 3 — The loop runs overnight and when idle

1. The learning loop SHALL run on its own at most once per night, when the
   server's local time is inside the operator's window.
2. The default window SHALL be 00:00 to 04:00 local time. The operator SHALL be
   able to change it in the extension's Settings, or in `learning.json` in the
   config directory. Times are 24-hour `HH:MM`. A window whose end is before its
   start crosses midnight.
3. A scheduled run SHALL NOT start when a scheduled run finished in the last 20
   hours. A manual run SHALL NOT count toward that limit.
4. Each run (`schedule`, `idle` or `manual`) SHALL write a `learning.run` event
   with the time, the trigger, the number of new suggestions and the runtime
   in milliseconds.
5. A failing run SHALL be logged and SHALL NOT stop the server.
6. The loop SHALL also run on its own (trigger `idle`) when all of these hold:
   the operator has not turned it off; no run of any trigger started in the last
   `minGapMinutes`; no event other than `learning.*` and `direction.proposal`
   was written in the last `idleMinutes`; and at least `minNewDecisions` events
   of kind `action.sent`, `action.discarded` or `signal.reclassified` were
   written since the last run.
7. The defaults SHALL be on, 10 minutes idle, 5 new decisions and 60 minutes
   between runs. The operator SHALL be able to change them in Settings or in
   `learning.json`. Ranges: idle 1 to 240, decisions 1 to 1000, gap 5 to 1440.
8. Only one run SHALL be in progress at a time. A manual run during a run SHALL
   be refused with 409, and the scheduler SHALL skip its tick.

## Requirement 4 — A suggestion is not repeated

Implements requirement 4.4 of `learning-loop-metrics`.

1. A suggestion SHALL NOT be stored when an identical one (same kind, Direction,
   field and proposed value) is still pending.
2. A suggestion SHALL NOT be stored when an identical one was accepted or
   rejected within the last 30 days.
3. After 30 days an identical suggestion MAY be stored again if the data still
   supports it.

## Requirement 5 — Suggestions are readable

1. Each suggestion SHALL be shown as a headline saying what is suggested, the
   exact change in words (percentages, not `0.75`; no internal field names), the
   reason with the counts behind it, and what Accept and Reject do.
2. The view SHALL say when the loop runs and when it last ran.
3. Pending suggestions SHALL be shown before answered ones.
4. The AI explanation SHALL be labelled as commentary, separate from the counted evidence.
5. The view SHALL list the operator's learnings, show the files that were
   skipped and why, and open a file for editing. It SHALL NOT edit files itself.
