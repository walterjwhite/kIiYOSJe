# Tasks — injection tripwire

- [x] 1. Pattern scan with `@stackone/defender` Tier 1, names only (`injection.ts`)
- [x] 2. Hold in `ingest()` before classify, transform, draft, and link; escalate with reason
- [x] 3. Record pattern names on `signal.processed`; no matched text
- [x] 4. Evaluation fixtures: caught by patterns, and a known miss
- [x] 5. DISCLOSURES and CHANGELOG
- [ ] 6. Update `security.md` and `testing.md` to name the tripwire (policy steering: needs `human-approved-scope`)
- [ ] 7. Measure false holds on a week of real mail and record the rate
- [ ] 8. Decide on the ML layer once the miss rate is known
