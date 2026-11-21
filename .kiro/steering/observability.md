---
inclusion: auto
---

# Observability

Everything stays local. There is no telemetry, no remote error reporting, and no
analytics. The operator's tools are logs, the `events` and `actions` tables,
`/health`, and `/metrics`.

## Logging (pino)

- JSON in production (`MIND_LOG_JSON`), level from `MIND_LOG_LEVEL`.
- Standard fields: `correlationId` (one per signal), `adapter`, `account`
  (a label, not an address), `stage`, `durationMs`, `outcome`.
- Never log message bodies, subjects, addresses, prompts, model output text,
  tokens, or credentials. If a field might hold any of these, do not log it.
- `error` level means something needs the operator. A single unreachable provider
  is `warn` with backoff, not a stream of errors.
- Use child loggers per module; do not construct new pino instances.

## Decisions are the audit trail

Every business decision writes one `actions` row and one `events` row, including
"did nothing and why". Sends must be reconstructible from `events` alone. Record
the Direction, posture, gate results, model id, and prompt version, not content.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health` | process up, DB reachable, per adapter: id, account label, state (`not configured`, `observe`, `ok`, `failing`), last success time |
| `GET /metrics` | signals, Thoughts, and the weekly ratio (signals ÷ thoughts) with a trailing series; absorb rate per Direction; model latency percentiles; deferred count; token usage |

Both require the bearer token. Neither exposes content.

## Metrics that matter

1. **Signals ÷ Thoughts per week.** The product metric. It must rise as Direction
   coverage grows. If it does not, change the model, not the prompts.
2. Direction coverage: share of signals matched by an authored Direction rather
   than the catch-all.
3. False-absorb rate from review (things the operator reopened or corrected).
4. Stage latency and model latency, p50/p95.
5. Send gate refusals by gate.

## Rules

- No badge counts, status-bar counters, or notifications. Metrics are pulled on
  demand through the CLI and the `/metrics` route.
- A failing adapter changes `/health` state and logs once per backoff window.
- Add a metric only with a question it answers. Remove one nobody reads.
