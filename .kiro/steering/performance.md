---

## inclusion: auto

# Performance and resource use

`mind` is one process and one SQLite file on the operator's machine, running next
to an editor and possibly a local model. It must stay quiet on CPU, memory, and
disk. Performance work is driven by numbers, not guesses: measure, change, measure.

## Budgets (initial targets; replace with measured values from the benchmark)

| Measure                                             | Budget                                      |
| --------------------------------------------------- | ------------------------------------------- |
| Idle RSS of the server                              | under 150 MB                                |
| Dedupe + normalize + match per signal               | p95 under 20 ms                             |
| Queue, Thoughts, Signals list query at 100k signals | p95 under 50 ms                             |
| Ingest throughput excluding model calls             | at least 200 signals per second             |
| Database growth                                     | under 5 KB per stored signal excluding body |
| Startup to `/health`                                | under 3 s                                   |

Model latency is outside these budgets but is bounded (below).

## SQLite

- Open with WAL, `foreign_keys=ON`, `busy_timeout`, `synchronous=NORMAL`.
  Run `PRAGMA optimize` on close and daily.
- Every list endpoint paginates with a hard cap. No unbounded `SELECT`.
- Index for the queries that exist; check with `EXPLAIN QUERY PLAN`. Indexes
  ship as new migrations.
- Wrap each signal's writes in one transaction. better-sqlite3 is synchronous:
  keep transactions short and never await inside one.
- Retention (`MIND_RETENTION_DAYS`) deletes in batches, then `wal_checkpoint`.
  `VACUUM` only on explicit command or low-activity schedule.

## Model calls

- Concurrency cap (default 2), per-call timeout, bounded retry with exponential
  backoff and jitter, and a circuit breaker. Defer, never drop, a signal when the
  provider is unavailable.
- Dedupe and match before inference; never call the model for a duplicate or for
  a signal a Direction absorbs without needing classification.
- Truncate and strip quoted history before building prompts. Track token counts.
- Cloud providers get a daily token ceiling. Local Ollama is the default.
- Cache nothing that contains message content outside SQLite.

## Process

- No work on the event loop that scales with history. Heavy jobs (retention,
  backup, insight generation) run in small batches with `setImmediate` yields.
- Adapters poll with backoff and respect provider rate limits and `Retry-After`.
- Hot-reload of config and directions is mtime-based; do not re-read unchanged files.
- The extension asks the server for what it displays and caches nothing private.
  Refresh is on review cadence, not a tight poll.

## How to change performance-sensitive code

State the metric, the before and after numbers from `scripts/bench.mjs`, and the
dataset size in the PR. A change that regresses a budget by more than 2x needs a
stated reason.
