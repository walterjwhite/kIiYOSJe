# Design — learning loop and metrics

## Computation

A pure function over rows: `weeklyMetrics(rows, tz, now)`. The route and CLI call
it; nothing else computes the ratio. Inputs: signals (`receivedAt`), Thoughts
(`createdAt`), actions (absorbed, corrected), Directions (matched or catch-all).

```
GET /metrics ->
{ week: { start, signals, thoughts, ratio|null, coverage, falseAbsorbRate },
  series: [ ...4 weeks... ],
  warnings: [ "ratio rising while false-absorb rising" ] }
```

## Corrections

Operator actions that reverse an absorb (reopen, edit a sent-or-drafted answer,
re-route) write a `correction` event linked to the original action. This is the
only source for false-absorb rate; no inference from silence.

## Learning loop

`learning-loop.ts` and `learning-insight.ts` produce proposals as data. Proposals
live in a table with status (`open`, `accepted`, `rejected`) and signal-id
citations. Acceptance returns a YAML patch; it does not write to the directions
directory or the database.

## Reading the result

The metric is a trend, not a target. Compare weekly values against Direction
count and coverage in the same window. Record findings, including negative ones,
in STATUS.md.

## Tests

- Zero-thought week, week boundaries, time zones, duplicate exclusion.
- A correction raises false-absorb rate and triggers the warning.
- Accepting a proposal changes no rows other than the proposal status.
