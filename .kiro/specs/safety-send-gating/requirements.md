# Requirements — safety and send gating

## Introduction

`mind` can send messages as the operator. This spec states what must be true
before any send happens, and what happens when anything is uncertain. It refines
the "Safety posture" in `.kiro/steering/product.md` into testable criteria.

## Requirement 1 — Observe by default

**User story:** As the operator, I want a new source to do nothing visible, so I
can see what it would have done before I trust it.

1. WHEN an adapter is added without an explicit `autonomy` THEN the system SHALL
   treat it as `observe`.
2. WHILE a source is `observe` THEN the system SHALL ingest, classify, and record
   what it would have done, and SHALL NOT write to the provider.

## Requirement 2 — Five gates, any one blocks

**User story:** As the operator, I want a send to require everything to be right,
so a single misconfiguration cannot send a message.

1. A send SHALL proceed only when ALL hold: the adapter reports the capability to
   send; the matched Direction sets `autonomy: send`; `MIND_SEND_ENABLED` is
   `true`; no pause flag is set; the draft is non-empty.
2. WHEN any one condition is false THEN the system SHALL NOT send and SHALL record
   an action naming the gate that stopped it.
3. The gates SHALL be evaluated again at send time, not only when the decision
   was made.

## Requirement 3 — Human approval authorizes sends from the Queue

1. WHEN a draft needs approval THEN only an explicit approve action in the Queue
   SHALL authorize the send.
2. The approve action SHALL re-check all gates before sending.
3. WHEN an operator edits a draft after approval was requested THEN the approval
   SHALL apply to the edited text only if the operator approves again.

## Requirement 4 — Pause

1. WHEN the pause flag is set THEN no send SHALL occur from any path, including
   a send already queued or in progress between stages.
2. Pausing SHALL NOT stop ingest, classification, or recording.
3. `mind pause` and `mind resume` SHALL be logged as events without content.

## Requirement 5 — Idempotent, recoverable sends

1. BEFORE calling the provider the system SHALL durably record a send intent with
   an idempotency key.
2. WHEN the process restarts THEN intents without a recorded result SHALL be
   reconciled against the provider where possible and SHALL NOT be resent blindly.
3. A retry of the same intent SHALL NOT produce a second message.

## Requirement 6 — Untrusted content cannot authorize anything

1. Message text, headers, and model output SHALL NOT change autonomy, the matched
   Direction, the recipient set beyond the thread, or the gates.
2. WHEN content contains instructions addressed to the assistant THEN the system
   SHALL treat them as data and MAY surface the signal to the operator.
3. A corpus of hostile fixtures SHALL run in CI and none SHALL produce a send.

## Requirement 7 — Failure never sends

1. WHEN the model is unavailable, times out, or returns invalid structure THEN the
   system SHALL defer the signal and SHALL NOT absorb or send it.
2. WHEN an adapter token is missing or revoked THEN the adapter SHALL report "not
   configured" and SHALL NOT affect other adapters.

## Requirement 8 — Auditability

1. Every send, refusal, and approval SHALL write an `actions` row and an `events`
   row sufficient to reconstruct who or what authorized it, which gates passed,
   and the model and prompt version, without storing message content in logs.
