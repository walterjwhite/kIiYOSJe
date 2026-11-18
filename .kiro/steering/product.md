---
inclusion: always
---

# Product

`mind` is a local, single-operator attention manager. It ingests signals from
messaging, mail, and calendar sources, matches them against Directions the
operator authors, drafts or sends replies, and surfaces only the decisions that
genuinely need a human.

## The thesis

Thoughts are the primary object; signals are evidence. A signal a Direction can
absorb is answered and dies. A Thought exists only where there is ambiguity,
consequence, or a decision that belongs to the operator.

The product metric is:

> signals per week ÷ thoughts per week — this ratio must rise.

If it does not rise as Direction coverage grows, the model is wrong and the
design should change, not the prompts.

## Non-goals

- Not a notification system. Nothing is pushed; there is no inbox.
- Not a chat assistant that has to be prompted. It runs on ingest and review cadence.
- Not distributed. One process, one SQLite file, one machine.
- Not a task manager. Commitments are captured and linked, not worked.
- Not multi-user yet. One operator per instance for now; multi-user is planned
  (DIRECTION.md §2.1), a hosted accounts/sync service is not.

## Safety posture

- New sources default to `observe`: ingest, classify, record what it would have
  done, write nothing.
- Sending requires the conjunction of adapter capability, `autonomy: send`,
  `MIND_SEND_ENABLED=true`, and no pause flag. Any one gate stops a send.
- Human approval in the Queue is the only place a send is authorized.
- An empty draft is never auto-sent.
- No badge counts, status-bar counters, or notifications. Absence is the feature.

## Privacy boundary

Everything is local except classifier and drafting calls to the configured model
provider. That is the one deliberate egress and it must stay visible in config.
A local Ollama model is the default so the deliberate egress can be zero.
