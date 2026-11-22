# Requirements — injection tripwire

## Introduction

`security.md` rule 2 says message text is data, and the injection corpus must stay
green. The defenses are delimited prompts and the send gates. This spec adds a
cheap tripwire in front of them. A tripwire is not a defense: it catches known
phrasing and nothing else.

## Requirement 1 — Detect known phrasing before any model call

1. WHEN a signal's subject or body contains known injection phrasing (an
   instruction override, a request to reveal the system prompt, a role marker)
   THEN the pipeline SHALL hold it before classify, transform, draft, or link.
2. The scan SHALL run in process, with no network call and no model call, and
   SHALL cover at most the first 20,000 characters.
3. Structural signals (length, entropy, formatting) SHALL NOT trigger a hold.

## Requirement 2 — A hold is conservative

1. A held signal SHALL be escalated whatever its Direction's posture or autonomy,
   and SHALL become a Thought with reason "possible prompt injection".
2. A held signal SHALL NOT be drafted, sent, absorbed, or auto-linked.
3. The hold SHALL NOT depend on, or be loosened by, model output.

## Requirement 3 — The record keeps no content

1. The `signal.processed` event SHALL record the risk, the pattern names, and the
   categories, and SHALL NOT record matched text.
2. Logs SHALL carry pattern names and categories only.

## Requirement 4 — Honest limits

1. The docs SHALL state that the tripwire misses paraphrased and novel
   instructions, and that the send gates remain the defense.
2. A fixture for a miss SHALL stay in the evaluation set as a known gap until a
   stronger layer closes it.

## Decision record

- **Library:** `@stackone/defender` 0.9.6, Tier 1 only. Apache-2.0, one transitive
  dependency (`nanoid`, MIT), no install scripts, no network.
- **Not chosen now:** its Tier 2 classifier needs `onnxruntime-node` (about
  218 MB, with a postinstall download) and `@huggingface/transformers` (about
  48 MB plus `sharp`). That is a large native footprint against the 150 MB idle
  memory budget and the supply-chain rules. `@yfedoseev/jailguard` (MIT OR
  Apache-2.0) is a smaller classifier but ships native binaries, downloads a 90 MB
  model from the internet on first use, and is a young project.
- **Revisit when:** the live week or the evaluation set shows paraphrased attacks
  getting through, or the operator accepts the footprint.
