# Tasks — learnings files and the nightly learning loop

- [x] 1. Nightly window setting, default 00:00 to 04:00, in Settings and `learning.json` (`learning-settings.ts`, `/admin/learning`)
- [x] 2. Scheduler runs once per night inside the window; manual runs share the same function (`learning-cycle.ts`)
- [x] 3. De-duplicate pending and recently resolved suggestions (`learning-loop.ts`)
- [x] 4. `learnings/*.md` loader with front matter, limits, mtime cache (`learnings.ts`)
- [x] 5. Learnings added to classify and draft prompts; prompt unchanged when none apply
- [x] 6. Learning ids recorded in `signal.processed`
- [x] 7. `GET /learnings` and the Learnings view list files, problems, and open a file
- [x] 8. Suggestions shown in plain language (`learnings-model.ts`)
- [x] 9. Docs: `learnings/README.md`, README, `.env.example`, `privacy-data.md`, `structure.md`, CHANGELOG
- [ ] 10. Eval: run the labelled set with and without a sample learning before recommending learnings to others (`ai-quality.md`). Not run: the harness is not built (see `learning-loop-metrics` task 9).
- [ ] 11. Live-model check that a learning changes a classification or a draft. Unit tests show the text reaches the prompt, not that a model follows it.
- [ ] 12. Make the 30-day cooldown operator-configurable
- [ ] 13. Draft a learning from the operator's corrections, for the operator to edit and commit
- [x] 14. Idle trigger with `idleEnabled`, `idleMinutes`, `minNewDecisions`, `minGapMinutes` settings; run runtime recorded; one run at a time (`learning-cycle.ts`, `learning-settings.ts`, Settings view)
