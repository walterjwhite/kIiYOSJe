# Design — safety and send gating

## Single choke point

All sends go through one function in the pipeline (`autosend` / the approve path
in `routes/actions.ts` calling it). Adapters expose `send` but never decide.
The function:

1. Loads the draft and the Direction fresh from the database.
2. Evaluates gates as a pure function `evaluateGates(input) -> { ok, failed[] }`
   so each gate is unit-testable on its own.
3. Writes a `send_intent` (new table, migration) with an idempotency key derived
   from `thoughtId + draftHash + recipientSet`.
4. Re-evaluates gates, then calls `adapter.send(draft, idempotencyKey)`.
5. Records the result on the intent, then writes the `actions` and `events` rows.

## Idempotency per provider

- Gmail and Graph: store the provider message id on success; on restart look up
  the Sent folder by a header (`X-Mind-Intent`) before resending.
- Matrix (gmessages bridge): use the transaction id as the idempotency key.
- If a provider cannot be queried, the intent is marked `unknown` and surfaces as
  a Thought for the operator. It is never retried automatically.

## Pause

A flag file or database row read on every send. Pause is checked inside step 4,
not cached, so it takes effect for in-flight batches.

## Injection defense

Prompts wrap content in delimiters and instruct the model to treat it as data.
That is a mitigation, not a control. The controls are structural: posture comes
from the Direction, autonomy from config, and the model only chooses among
allowed outcomes. Output is parsed with zod; unknown values are rejected.

## Testing

- Gate matrix: one test per gate, plus all-open.
- Crash test: kill after provider call, restart, assert no resend.
- Injection corpus with a stub model that obeys the hostile text.
- Gates re-checked at send time: flip a gate between decide and send.

## Decisions to keep

- The empty-draft check is a gate, not a validation, so it shows up in the audit trail.
- No "force send" flag. Operators who want to bypass approval set `autonomy: send`
  on a Direction and enable sending explicitly.
