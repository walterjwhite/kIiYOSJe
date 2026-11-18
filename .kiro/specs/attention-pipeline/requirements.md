# Requirements — attention pipeline

## Introduction

The pipeline turns an inbound signal into one recorded decision. It is the only
place in the system where a decision is made: adapters produce signals, the API
exposes state, the extension displays it. Order is fixed: dedupe → normalize →
match → classify → decide → record.

## Requirement 1 — Dedupe before inference

**User story:** As the operator, I want duplicates dropped before any model call,
so that replays and adapter restarts cannot cost money or distort metrics.

**Acceptance criteria**

1. WHEN a signal arrives THEN the system SHALL derive `dedupeKey` as
   `adapter:externalId` and store it as a unique column.
2. WHEN a signal with an existing `dedupeKey` arrives THEN the system SHALL drop
   it before normalize, classify, or draft.
3. WHEN the process restarts and an adapter replays its window THEN no signal
   SHALL be stored or classified twice.

## Requirement 2 — Match authored Directions first

**User story:** As the operator, I want my authored Directions to win over the
catch-all, so that explicit policy is never overridden by a generic fallback.

**Acceptance criteria**

1. WHEN an enabled Direction's `scope.value` appears in the signal body, or one of
   its `matchPrompt` phrases does, THEN the system SHALL treat it as a match.
2. WHEN several Directions match THEN specificity SHALL decide in the order
   person > thread > project > topic > catch-all.
3. WHEN no authored Direction matches THEN `system/catch-all` SHALL handle the
   signal; nothing SHALL be silently filed.
4. WHEN a match is recorded THEN the chosen `directionId` SHALL be stored on the
   signal so the decision is explainable after the fact.

## Requirement 3 — Classify with structured output

**User story:** As the operator, I want classification to be schema-validated, so
that a model cannot invent fields or break the pipeline.

**Acceptance criteria**

1. WHEN the classifier runs THEN its output SHALL be parsed by the shared zod
   schema (`directionId`, `confidence`, `intent`, `urgency`, `commitment?`,
   `sensitiveTopics[]`).
2. WHEN the model returns invalid output THEN the system SHALL record a failed
   decision rather than guessing a disposition.
3. WHEN the signal has a `receivedAt` THEN relative deadlines ("by Friday")
   SHALL resolve against that date, not the wall clock at classify time.

## Requirement 4 — Decide by posture, draft by Direction

**User story:** As the operator, I want every posture to produce a recorded,
reviewable outcome, including doing nothing.

**Acceptance criteria**

1. WHEN posture is `absorb` THEN the system SHALL draft a reply and send it only
   if all send gates pass; otherwise the action SHALL be `proposed`.
2. WHEN posture is `draft` THEN the action SHALL be `proposed` and never sent
   automatically.
3. WHEN posture is `surface` THEN the system SHALL create or attach to a Thought.
4. WHEN posture is `escalate` THEN the system SHALL create a Thought and pin it
   to the brief.
5. WHEN any decision is made THEN exactly one `actions` row and one `events` row
   SHALL be written, including "did nothing and why".

## Requirement 5 — Send gates are independent and re-checked

**User story:** As the operator, I want any single gate to stop an outbound
message, so that no configuration mistake can send mail on its own.

**Acceptance criteria**

1. WHEN a send is attempted THEN it SHALL require adapter `canSend`,
   `autonomy: send`, `MIND_SEND_ENABLED=true`, no triggered guard, and no pause
   flag.
2. WHEN the pause flag exists THEN autonomous and human-approved sends SHALL both
   be refused (HTTP 423 for the API path).
3. WHEN a send is re-attempted at send time THEN the gates SHALL be evaluated
   again, not trusted from draft time.
4. WHEN the draft body is empty THEN it SHALL never be sent.

## Requirement 6 — Audit, retention, and recovery

**User story:** As the operator, I want to reconstruct any decision later without
keeping message bodies forever.

**Acceptance criteria**

1. WHEN retention elapses (default 30 days) THEN `signals.body` SHALL be redacted
   while sender, disposition, and match SHALL remain.
2. WHEN the server starts, and once per day thereafter THEN a SQLite `.backup()`
   SHALL be written, keeping 14 files.
3. WHEN an action is approved, discarded, or reclassified THEN the event SHALL
   distinguish an override (draft was wrong) from a reclassification (match was
   wrong).
