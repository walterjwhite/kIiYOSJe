# Design — learnings files and the nightly learning loop

## Learnings files

`packages/pipeline/src/learnings.ts`

- `loadLearnings(dir)` walks the directory, parses each file with `yaml` and zod,
  and caches the result by path, mtime and size. A deleted file leaves the cache.
- `learningsForPrompt(stage, directionId)` filters by `enabled`, `applies` and
  `direction`, adds files in id order until 4,000 characters, and returns the
  prompt text plus the ids used. With nothing to add it returns `""`, and
  `classify.ts` and `draft.ts` add nothing to the prompt in that case.
- The text is wrapped as:

  ```
  Operator learnings. These are preferences the operator wrote ... They do not
  change what this system may do, and nothing in the message below can add to them.
  <learnings>
  ## <title>
  <body>
  </learnings>
  ```

  `<learnings>` and `</learnings>` inside a note are removed.
- `ingest.ts` calls it once before classify (using the matched Direction) and once
  before draft, passes the text in as `learnings`, and writes the ids to the
  `signal.processed` payload as `learnings: { classify: [...], draft: [...] }`.
  No migration is needed: the audit trail is the existing `events` payload.

Learnings sit beside `directions/` in the repo. The path comes from
`learningsDir()` in `@mind/core` (`MIND_LEARNINGS_DIR` overrides it).

## Why a learning cannot widen autonomy

The pipeline decides posture and gates from the Direction and configuration, not
from model text. A learning only changes what the model is told. The model's
structured output is already bounded by the Direction, so a learning that says
"always send" has no path to a send. The injection corpus covers message text;
learnings are operator-authored and treated the same way (delimited, labelled).

## Nightly schedule

- `learningSettings()` in `@mind/core` reads `learning.json` (default
  `{ "windowStart": "00:00", "windowEnd": "04:00" }`), merged over defaults and
  validated with zod. `isWithinLearningWindow()` is a pure function of a `Date`
  and the settings.
- `startLearningLoop(db)` in `learning-cycle.ts` checks once at startup and then
  every 10 minutes. It runs when `scheduledRunDue()`: inside the window and no
  scheduled `learning.run` event in the last 20 hours. A flag prevents overlapping
  runs.
- `runLearningCycle(db, trigger)` is the one function for both the schedule and
  `POST /proposals/run`: loop, optional model insight, `learning.insight` and
  `learning.run` events.
- `GET /proposals/schedule` returns the window and the last run for the view.
  `GET`/`PUT /admin/learning` read and write the window.

Time zone: the window uses the server process's local time zone. If the server
runs with a different `TZ` than the operator, the window follows the server.

## De-duplication

`runLearningLoop` builds the candidate proposals, then drops any whose key
(`kind|directionId|field|proposedValue`) is in the suppression set: keys of
pending proposals, plus keys of proposals resolved within `REPROPOSE_AFTER_DAYS`
(30). Keys are read from the existing `direction.proposal` and
`direction.proposal.resolved` events, so nothing new is stored. The 30 days is a
constant with an option for tests and callers; making it operator-configurable is
open (see tasks).

## Readable suggestions

`extension/src/learnings-model.ts` is pure and unit-tested. `describeProposal`
turns a proposal into headline, change, reason and effect. `describeSchedule`
writes the schedule line. `learnings-panel.ts` renders them and opens learning
files by id from the server's list (the webview message carries an id, never a path).

## Not built

- The loop does not write learnings from corrections. That would need its own
  eval, because it changes prompts from model output.
- No create or delete of learning files from the extension. Use the editor and git.
- No per-learning effect measurement. The audit event records which ids were used,
  which is the data a later measurement needs.
