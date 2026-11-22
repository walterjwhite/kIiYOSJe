# Tasks — evaluation harness

- [x] 1. Fixture schema and loader (`src/eval/fixtures.ts`), invalid file fails with its path
- [x] 2. Pure metrics with empty-denominator cases (`src/eval/metrics.ts`)
- [x] 3. Eval Directions and the first labelled fixtures (`packages/pipeline/eval/`)
- [x] 4. Runner over `ingest()` with per-fixture database and counting adapter (`src/eval/runner.ts`)
- [x] 5. Text and JSON report with model id, prompt versions, date (`src/eval/report.ts`)
- [x] 6. CLI with `--live` and `--json` (`src/eval/cli.ts`)
- [x] 7. CI guard test asserting the floors (`src/eval/eval.test.ts`)
- [x] 8. Docs: README commands, `ai-quality.md` commands, `STATUS.md`, `CHANGELOG.md`, `learning-loop-metrics` task 9
- [ ] 9. Live-model run on the default model, report recorded in the PR (manual, needs a running model). Not run.
- [ ] 10. Add a fixture for each misclassification found in the live week
- [ ] 11. Compare a run with and without a learning (`learnings-files` task 10)
