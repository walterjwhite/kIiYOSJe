# Design — evaluation harness

## Layout

```
packages/pipeline/eval/            data only, no code
  fixtures.json                    the labelled signals
  directions/*.yaml                Directions the fixtures run against
packages/pipeline/src/eval/        code, compiled with the package, covered by tests
  fixtures.ts                      zod schema, loader
  metrics.ts                       pure arithmetic
  runner.ts                        runs fixtures through ingest()
  report.ts                        text and JSON output
  cli.ts                           node packages/pipeline/dist/eval/cli.js [--live] [--json]
  eval.test.ts                     the CI guard
```

Code sits under `src/` because the package compiles `src/` only and vitest
includes `packages/*/src/**/*.test.ts`. The data sits where `ai-quality.md`
says it does. Both resolve from `packages/pipeline/eval` by a path relative to
the module, which is the same from `src/eval` and `dist/eval`.

## Fixture

```json
{
  "id": "boss-routine-schedule",
  "note": "what this case checks",
  "signal": { "sender": "boss@eval.test", "subject": "...", "body": "...", "threadId": "t1" },
  "recorded": {
    "classifier": {
      "confidence": 0.95,
      "intent": "...",
      "signalKind": "question",
      "urgency": "low",
      "commitment": null,
      "commitmentDueDate": null,
      "escalateBy": null,
      "sensitiveTopics": [],
      "answerable": true,
      "answerBlocker": null
    },
    "draft": "Thursday at 10 works."
  },
  "expected": { "directionId": "boss", "surfaced": false },
  "known": null
}
```

`recorded.classifier` is the real `ClassifierOutputSchema`, so a schema change
breaks the fixtures loudly.

## Runner

For each fixture: open an in-memory SQLite database, run the migrations, load
`eval/directions` and the catch-all, build an `AdapterRegistry` holding a
counting send-capable adapter, and call `ingest(db, signal, adapters, overrides)`.
Then read the stored signal row for its Direction and disposition. Nothing is
shared between fixtures, so one case cannot change another.

`MIND_SEND_ENABLED` is removed for the run and restored after. A send is any call
to the test adapter's `send()`. The gate-refusal fixture uses a Direction with
`autonomy: send` and a confident classification, so only the global gate stands
between it and a send.

`--live` omits `classifierOutput` and `draftBody`. The model that answers is the
configured provider, so its id and the prompt versions go in the report.

## Metrics

```
surfaced    := disposition in {escalated, promoted}
recall      := TP / (TP + FN)          positives = expected.surfaced
precision   := TP / (TP + FP)
falseAbsorb := absorbed and expected.surfaced / absorbed
directionAccuracy := matched == expected, catch-all excluded
```

An empty denominator gives `null`. Known fixtures are listed and excluded.

## Decisions

- Fresh database per fixture costs a migration each time. For tens of fixtures
  that is well under a second, and it removes cross-case effects.
- Disposition, not draft presence, defines "surfaced". A draft in the Queue is
  absorbed per the thesis, though the operator still approves the send.
- The runner imports `ingest` and does not copy its logic, so the harness cannot
  drift from the pipeline.

## Failure behavior

An invalid fixture or Direction fails the run with its file. A fixture whose
`ingest()` throws is reported as an error for that fixture and counted as a
failure, not skipped.
