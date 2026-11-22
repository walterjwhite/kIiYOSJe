# Requirements — evaluation harness

## Introduction

`DIRECTION.md` move 5 is "a reproducible eval: fixture stream + recorded model
output → absorb/override report in CI". `ai-quality.md` defines the metrics and
says `packages/pipeline/eval` holds labelled synthetic signals and a runner.
Neither exists. This spec builds them.

The harness answers one question with numbers a reviewer can reproduce without
the operator's mailbox: given labelled signals, does the real pipeline (match,
decide, gates, record) surface the right few and absorb the rest?

## Requirement 1 — Labelled synthetic fixtures

1. The repository SHALL contain labelled fixtures under `packages/pipeline/eval/`.
   Each has a signal, a recorded classifier output, an optional recorded draft,
   and expected labels: the Direction it should match, and whether a human would
   want it surfaced.
2. Every fixture SHALL be synthetic. Senders use `.test` domains. No real names,
   addresses, or message text (`privacy-data.md` rule 7).
3. A fixture MAY carry `known: "<reason>"` when the pipeline is known to
   disagree with the label. Known cases SHALL be reported separately and SHALL
   NOT count toward the floors, so a documented gap does not hide behind a green
   run and a new regression is not excused.
4. Fixtures SHALL be validated with zod when loaded. An invalid fixture file
   SHALL fail the run with the file and the reason.
5. The set SHALL include: routine absorbs, low-confidence, a confident but
   unanswerable question, a surface-posture Direction, an unknown sender, a
   catch-all fallthrough, a message that tries to instruct the model, and a send
   attempt with the gates closed.

## Requirement 2 — A runner that uses the real pipeline

1. The runner SHALL call `ingest()` for each fixture with the recorded classifier
   output and draft supplied as overrides, so no model is called.
2. Each fixture SHALL run against its own in-memory database, migrated from
   `packages/core/migrations`, with the eval Directions from
   `packages/pipeline/eval/directions/` and the catch-all loaded.
3. The runner SHALL NOT send anything. It SHALL register a send-capable test
   adapter that counts calls to `send()`, and SHALL run with
   `MIND_SEND_ENABLED` unset. The count of sends is the gate violation count.
4. The runner SHALL NOT call a real provider API, read the operator's config or
   database, or write outside a temporary directory.
5. A `--live` mode SHALL omit the overrides so the configured model classifies
   and drafts. It is a manual command. CI SHALL NOT run it.

## Requirement 3 — Metrics

The report SHALL compute, over fixtures that are not `known`:

1. **Surface recall**: of fixtures labelled surfaced, the share the pipeline
   surfaced. Target 0.95 or more.
2. **Surface precision**: of fixtures the pipeline surfaced, the share labelled
   surfaced.
3. **False-absorb rate**: of fixtures the pipeline absorbed, the share labelled
   surfaced. Target 0.02 or less.
4. **Direction accuracy**: share whose matched Direction equals the label, with
   the catch-all excluded from the denominator and reported as coverage.
5. **Gate violations**: sends that happened. SHALL be 0.
6. **Ratio**: signals divided by Thoughts created, or `null` when there are no
   Thoughts.

A signal counts as surfaced when its disposition is `escalated` or `promoted`.
Each metric with an empty denominator SHALL be `null`, not 0 or 1.

## Requirement 4 — Output and CI

1. The runner SHALL print a plain-text report and, with `--json`, a JSON report.
   Both include the model id (`stub` or the live provider and model), the prompt
   versions, the fixture count, the known count, and the date.
2. Each failing fixture SHALL be listed with its id, the label, and what the
   pipeline did.
3. The test suite SHALL run the harness with the recorded outputs and assert the
   floors: recall at or above 0.95, false-absorb at or below 0.02, zero gate
   violations, and every non-known fixture matching its label.
4. The metric functions SHALL be pure and unit-tested, including empty
   denominators, so a change to the arithmetic is caught.

## Requirement 5 — Change control

1. A prompt or model change SHALL attach the report before and after
   (`ai-quality.md`). A drop in recall or a rise in false-absorb SHALL block it.
2. Every misclassification found in real use SHALL be added as a synthetic
   fixture.
3. The README and `ai-quality.md` SHALL give the exact commands to run the stub
   and live modes.

## Out of scope

- Embeddings, learnings comparisons, and the injection corpus (it already exists
  in the pipeline tests). Comparing a run with and without a learning is a
  follow-up (`learnings-files` task 10).
- Reading real signals. Fixtures are written by hand or generated from the demo
  personas after they are made synthetic.
- New dependencies, changes to send gates, auth, migrations, or `.github/`.
