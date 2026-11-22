# Issue draft — Build a labelled evaluation set and harness

Paste into the "Task (agent-ready)" form. A maintainer applies `ai-ready` after
reading it. Labels to set by hand: `ai-quality`. Not `human-approved-scope`,
`deps-approved`, or `needs-human-decision`: nothing here touches protected paths,
manifests, or send gates.

**Type:** test

**Problem and why it matters**

`DIRECTION.md` move 5 promises a reproducible eval, and `ai-quality.md` names
`packages/pipeline/eval`, but neither the fixtures nor a runner exist. Without
them the absorb and surface claims rest on anecdote, a prompt or model change
cannot be checked for regressions, and STATUS gap #12 (literal substring
matching) cannot be measured. Spec: `.kiro/specs/eval-harness/`.

**Scope**

In: `packages/pipeline/eval/` (fixtures, Directions), `packages/pipeline/src/eval/`
(loader, metrics, runner, report, CLI, test), README and `ai-quality.md` command
docs, `CHANGELOG.md`, `STATUS.md`, `tasks.md`.
Out: new dependencies, changes to `ingest()`, send gates, auth, migrations,
`.github/`, `package.json`, and live-model results (a human runs those).

**Acceptance criteria**

- [ ] At least 20 synthetic fixtures with labels, covering the cases in Requirement 1.5 of the spec; no real addresses or message text
- [ ] WHEN a fixture file is invalid THEN the run SHALL fail and name the file and the reason
- [ ] The runner SHALL call the real `ingest()` with recorded classifier output and draft, one in-memory database per fixture, and no network
- [ ] WHEN `MIND_SEND_ENABLED` is unset THEN a send-capable adapter SHALL receive zero `send()` calls, and the count is reported as gate violations
- [ ] The report SHALL give surface recall, surface precision, false-absorb rate, direction accuracy, gate violations, and the signals-to-Thoughts ratio, with `null` for an empty denominator
- [ ] Fixtures marked `known` SHALL be listed separately and excluded from the floors
- [ ] `node packages/pipeline/dist/eval/cli.js` prints the report; `--json` prints JSON; `--live` uses the configured model and is not run in CI
- [ ] A test asserts recall at or above 0.95, false-absorb at or below 0.02, zero gate violations, and every non-known fixture matching its label
- [ ] Metric functions are unit-tested, including empty denominators
- [ ] `npm run lint`, `npm run test:coverage`, `npm run license:check`, and `node scripts/check-secrets.mjs` pass

**Related spec, steering, or docs**

`.kiro/specs/eval-harness/`, `.kiro/steering/ai-quality.md`, `DIRECTION.md` (move 5),
`.kiro/steering/privacy-data.md` (fixtures are synthetic),
`.kiro/specs/learning-loop-metrics/tasks.md` (task 9).

**Constraints acknowledged**

- [x] No new dependency unless this issue says so (license check required).
- [x] No change to the send gates, auth, migrations already applied, or licensing without explicit approval in this issue.
