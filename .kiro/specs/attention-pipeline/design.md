# Design — attention pipeline

## Overview

One synchronous path per signal, with exactly one awaited model call for
classification and one for drafting when the posture requires it.

```
adapter → Signal → dedupe → normalize → match → classify → decide → record
                                                              ├── Action (proposed/sent)
                                                              └── Thought (surface/escalate)
```

The pipeline never imports an adapter. It receives `NewSignal` values through a
sink and checks capabilities through `AdapterRegistry`, so a new source is a
class, not an integration.

## Components

| Component | Responsibility | File |
| --- | --- | --- |
| Dedupe | unique `dedupeKey`, drop repeats before inference | `pipeline/src/dedupe.ts` |
| Normalize | strip quotes/signatures, resolve participants | `pipeline/src/normalize.ts` |
| Match | specificity-ordered Direction selection | `pipeline/src/match.ts` |
| Classify | zod-validated structured output | `pipeline/src/classify.ts` |
| Draft | Direction `standard` + `responsePrompt` guidance | `pipeline/src/draft.ts` |
| Decide | posture → action/thought, send gates | `pipeline/src/decide.ts` |
| Record | one action + one event per decision | `pipeline/src/ingest.ts` |
| Directions loader | YAML → validated rows, hot reload | `pipeline/src/directions-loader.ts` |
| Guards | rate, sensitive topic, new recipient | `pipeline/src/guards.ts` |
| Learning loop | override-rate proposals, never auto-applied | `pipeline/src/learning-loop.ts` |

## Data model

Five tables (`directions`, `signals`, `thoughts`, `actions`, `events`) in SQLite
via Drizzle. Enums are stored as text and validated by zod on write. `events` is
append-only; nothing updates or deletes it.

## Matching

Scope kinds are ordered `person > thread > project > topic > catch-all`. A
Direction matches when its `scope.value` is a literal substring of the signal body
or when one of its `matchPrompt` phrases is. If nothing matches, the catch-all
handles the signal so no message is silently dropped.

## Error handling

- Adapter failures are contained: `start()` catches, logs, and returns; the other
  sources keep running.
- `AdapterNotConfiguredError` is expected, log-level `info`, never a stack trace.
- Model failures record a failed decision with the reason; they never invent a
  disposition.
- Invalid classifier output fails the zod parse and is recorded, not repaired.

## Correctness properties

1. For any signal, at most one non-duplicate row exists per `(adapter, externalId)`.
2. For any decision, `actions` and `events` both gain exactly one row.
3. No send occurs unless all five gates hold at send time.
4. Redaction never removes the fields needed to compute metrics.
5. Replaying the same fixture stream twice produces the same stored state.

## Testing strategy

- Unit tests per pure stage (dedupe, normalize, match, guards, ics parsing,
  mappers) with fixtures, no network.
- Route tests against the Hono app with an in-memory SQLite database.
- Adapter contract suite (shared fixture stream) remains a known gap; until it
  exists, adapters are covered by mapper tests plus an unverified live path.
- Model calls are faked in tests; the real path is exercised only by the demo
  seeder against a configured provider.

## Risks

| Risk | Mitigation |
| --- | --- |
| Third-party API terms | documented APIs only (Gmail, Graph, Calendar); no unofficial clients |
| Model non-determinism in seeds | demo data stores bodies, never pre-computed classifications |
| Classifier over-confidence | `confidenceMin` per Direction plus override-rate auto-disable |
| Single-file data loss | startup + daily `.backup()`, 14 kept |
