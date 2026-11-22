# Tasks — knowledge base

Nothing is started. Parked until after 2026-12-04; see `HANDOFF.md`. Likely moves to a separate product, in which case most of these tasks move with it and only the export (and optionally a recall hook) stay in mind.

- [ ] 1. Answer the remaining open questions (1 to 5, 8 to 10; 6 and 7 are answered); revise requirements and design to match
- [ ] 1a. Design session: long-term direction and sequencing, before any code (see `DIRECTION.md` alignment table)
- [ ] 2. Inventory the metadata each adapter keeps (IP, headers, attachments) [Q4]
- [ ] 3. Policy loader and selector, with tests (`knowledge/policy.ts`)
- [ ] 4. Sanitizer with a hostile-content corpus (`knowledge/sanitize.ts`)
- [ ] 5. Entry store: render, parse, merge, expiry (`knowledge/store.ts`)
- [ ] 6. Migration for pending candidates and the extraction cursor
- [ ] 7. Extraction with a stub model, caps, deferral, and zod parsing
- [ ] 8. Run extraction from the idle and nightly learning runs
- [ ] 9. Routes: list, accept, reject, edit
- [ ] 10. Knowledge view in the extension
- [ ] 11. Injection corpus cases for extraction
- [ ] 12. Docs: `privacy-data.md`, `structure.md`, README, `.env.example`, CHANGELOG (needs `human-approved-scope`)
- [ ] 13. Eval: labelled synthetic signals for kind selection and summaries (`ai-quality.md`)
- [ ] 14. Later: deterministic known-sender lookup in the pipeline [Q7]
- [ ] 15. Keyword search: FTS5 index derived from the knowledge directory, rebuildable (Req. 9)
- [ ] 16. Decision: record the DIRECTION.md amendment for embeddings and questions, or drop them (Req. 10). Blocked on the FTS5 baseline in task 15 and on the design session.
- [ ] 17. If approved: local embeddings and exact vector search in a derived SQLite file; measure before adding a vector database or extension (Req. 10.1, 10.2)
- [ ] 18. If approved: on-request question answering with citations and a "nothing relevant" answer (Req. 10.3 to 10.5)
- [ ] 19. Retrieval eval: labelled synthetic set, FTS5 as the baseline (Req. 10.6)
