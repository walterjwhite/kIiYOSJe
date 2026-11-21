# Requirements — learning loop and the product metric

## Introduction

The product metric is signals per week ÷ Thoughts per week, and it must rise as
Direction coverage grows. This spec makes the metric measurable, honest, and
visible without notifications, and defines how proposals from the learning loop
reach the operator.

## Requirement 1 — The ratio is computed one way

1. The system SHALL compute weekly `signals` (distinct stored signals received),
   `thoughts` (Thoughts created), and `ratio = signals / thoughts`.
2. WHEN `thoughts` is zero THEN `ratio` SHALL be reported as `null` with
   `signals` shown, not as infinity or an error.
3. Weeks SHALL be ISO weeks in the operator's configured time zone, defaulting to UTC.
4. Duplicates dropped before inference SHALL NOT count as signals.

## Requirement 2 — Visible on demand, never pushed

1. `GET /metrics` SHALL return the current week and a trailing 4-week series.
2. The CLI SHALL print the same figures.
3. The extension MAY show them in a review view. It SHALL NOT add badges,
   counters, or notifications.

## Requirement 3 — Coverage and error rates

1. The system SHALL report Direction coverage: share of signals matched by an
   authored Direction rather than the catch-all.
2. The system SHALL record corrections: when the operator reopens, edits, or
   overrides an absorbed signal, that SHALL be stored as a false-absorb event.
3. A rising ratio with a rising false-absorb rate SHALL be shown as a warning in
   the metrics output, since the ratio alone can be gamed by over-absorbing.

## Requirement 4 — Learning-loop proposals

1. The learning loop MAY propose a new or changed Direction from observed
   signals and corrections.
2. A proposal SHALL NOT change behavior. Accepting it SHALL return the YAML edit
   for the operator to apply by hand, because `directions/*.yaml` is authoritative.
3. Proposals SHALL be generated on review cadence, not on every signal, and SHALL
   cite signal ids rather than copying content.
4. Rejected proposals SHALL not be re-proposed within a configurable period.

## Requirement 5 — Falsifiability

1. The project SHALL keep a dated series of the ratio and false-absorb rate so a
   plateau or decline is visible.
2. WHEN coverage grows and the ratio does not rise THEN the finding SHALL be
   written to STATUS.md and the design reconsidered, not the prompts tuned.
