---
inclusion: auto
---

# AI quality

The thesis is a ratio: signals absorbed per Thought surfaced. Quality here means
surfacing the right few things and absorbing the rest correctly. A confident wrong
absorb is worse than an extra Thought, so errors are not symmetric.

## What is measured

| Metric | Definition | Direction |
| --- | --- | --- |
| Surface recall | of signals a human would want to see, share surfaced | high, target ≥ 0.95 |
| Surface precision | of surfaced Thoughts, share the operator wanted | high, target ≥ 0.6 and rising |
| False-absorb rate | absorbed signals later corrected or reopened | low, target ≤ 0.02 |
| Draft acceptance | drafts approved without edit or with small edits | tracked, no target yet |
| Gate violations | sends outside Direction autonomy | must be 0 |
| Ratio | signals ÷ Thoughts per week | must rise |

Targets are starting points; replace them with measured baselines and record the
date and model.

## Evaluation

- `packages/pipeline/eval` holds labelled synthetic signals (expected Direction,
  posture, needs-human) and a runner.
- CI runs the suite with a stub model to guard plumbing. A live-model run is a
  documented manual command whose results are written to the PR.
- Compare models and prompts on the same fixtures. Report the metrics above, not
  anecdotes.
- Add a fixture for every misclassification found in real use (after making it
  synthetic).

## Versioning and change control

- Prompts are versioned constants. Each `actions` row stores the prompt version
  and model id.
- A prompt or model change ships with eval results before and after. A drop in
  surface recall or a rise in false-absorb blocks the change.
- Pin the default model name in config docs; Ollama default is
  `qwen2.5:3b-instruct`. Small local models draft mediocre text. Say so in docs.

## Failure behavior

- Model unavailable, timing out, or returning invalid structure: defer the
  signal, record why, retry with backoff. Never auto-absorb or auto-send on failure.
- Structured output is parsed with zod; a parse failure is a recorded outcome,
  not a crash.
- Deadlines are grounded against `receivedAt`, not the current time.
- Unknown sender, low confidence, or a consequential topic surfaces. Confidence
  below the Direction's threshold never absorbs.

## Safety interaction

Model output cannot widen autonomy. Posture is bounded by the matched Direction
and the send gates. Drafts are never sent empty. Content treated as data is
delimited in prompts and covered by the injection corpus.

## Open questions to answer with data, not opinion

- Does Direction coverage growth actually raise the ratio?
- Is literal substring `match()` the main source of catch-all fallthrough
  (STATUS.md gap #12)? Measure before replacing it.
- What model size is the minimum for acceptable drafts?
