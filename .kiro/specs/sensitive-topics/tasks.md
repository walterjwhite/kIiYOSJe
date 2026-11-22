# Tasks — sensitive topics and word matching

- [x] 1. Settings with defaults and validation (`sensitive-settings.ts`)
- [x] 2. `GET/PUT /admin/sensitive`
- [x] 3. Settings section in the extension
- [x] 4. Keyword and model-tag detection (`sensitive.ts`), whole words, stemmed
- [x] 5. Hold in `ingest()` after `decide()`; names recorded, never text
- [x] 6. Stemmed phrase matching for topic, project, and `matchPrompt` (`match.ts`, `text-match.ts`)
- [x] 7. Evaluation fixtures: sensitive topic held, stemmed scope match
- [ ] 8. Update `privacy-data.md` (data inventory: `sensitive.json`) and `product.md` (policy steering: needs `human-approved-scope`)
- [ ] 9. Tell the classifier the topic names so it tags them; evaluate first
- [ ] 10. Per-Direction topic lists, if the global list proves too blunt
- [ ] 11. Measure holds per topic in `/metrics` once there is real traffic
