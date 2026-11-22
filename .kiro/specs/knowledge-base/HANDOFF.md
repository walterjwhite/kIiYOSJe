# Knowledge base — decisions and how to resume

Recorded 2026-11-22 from the design discussion with the operator. Read this
first. `requirements.md`, `design.md`, and `tasks.md` in this folder hold the
detail and were written before the scope decision below, so where they disagree
with this file, this file wins.

## Status

**Parked until after the competition submission (2026-12-04). Nothing is built.**
No code, dependency, migration, or steering change has been made for it.

## What was decided

1. **Purpose.** The knowledge base helps the operator recall information while
   manually actioning signals. It is a recall aid for a human decision, not a
   way to make mind absorb more, yet. The operator expects that more knowledge
   brings more capability and that it will eventually help absorb more. That is a
   belief, not something shown.
2. **When.** After the competition. Do not start it before 2026-12-04. The work
   `DIRECTION.md` lists as next (eval harness, adapter contract suite, a live
   observe week) comes first.
3. **Storage.** Knowledge is Markdown in git, with related files (attachments)
   beside it. The operator reviews, approves, and commits. mind does not commit
   or push. Deleting an entry from the working tree is fine: git history keeps how
   it got there, and there is no history rewriting.
4. **Retrieval.** The operator wants a local vector database so proper RAG is an
   option: search, and ask questions against the knowledge. Everything stays local
   by default.
5. **Scope.** This is a separate goal and probably a separate product. mind
   would export data and the other product would ingest it. It does not directly
   serve the absorb-rate thesis in `DIRECTION.md` today (see item 1 for the
   operator's expectation that it may later), and it deviates from two of that
   document's refusals (no embeddings, no chat interface). Building it as its own
   product removes the deviation instead of excusing it.
6. **Benefit.** The operator still believes it will help, but when is not clear,
   and it has to be built first to find out. So the first build is a trial, kept
   small enough to throw away.
7. **Kill criterion (operator's words, paraphrased).** If it provides no benefit
   and there is no clear path forward, scrap it.

## Decisions carried over from earlier in the discussion

- Sending private signal text to the configured cloud model provider is
  acceptable to the operator.
- Knowledge is independent of Directions and of the signals it came from.
  Retention is its own, and different kinds of knowledge carry different
  suggested periods. Deleting a signal does not delete knowledge.
- Not everything is stored. Example: for spam, keep the sender address, a
  sanitized summary of what it sends, and useful metadata (date and time, source
  IP, other relevant fields). Not the body.
- Nothing is fed back into mind's classifier or drafter prompts.

## Not decided

These need an answer before design work resumes.

1. **The boundary between mind and the new product.** Candidate: mind writes a
   versioned export (JSON Lines, one signal per line, with ids, sender, kind,
   times, adapter, and the fields a policy asks for) to a directory, and the other
   product reads it. Open: who triggers it, which fields leave mind, and whether
   attachments are exported or referenced.
2. **Who does extraction.** In the earlier draft it ran inside mind's learning
   loop. If this is a separate product, extraction, policies, review, the git
   repository, and the index belong to it, and its model calls are its own egress.
   mind's "one deliberate egress" rule then does not cover it.
3. **How recall appears while actioning.** Showing relevant knowledge next to a
   signal means mind's extension or API asks the other product. That is a local
   call between two processes and needs its own spec in mind (new route or client,
   token, failure behavior: show nothing when the product is down).
4. **Which vector database.** The operator wants a local one. Two candidates
   stand out to the operator: PostgreSQL with a vector extension (pgvector), and
   LanceDB. Revisit the choice when work resumes, not before. Notes for that
   decision: LanceDB is embedded and file-based, with no server to run. Postgres
   is a server process, which suits a product that keeps other data too. The
   earlier engineering recommendation was exact search over stored vectors in a
   derived SQLite file first, adding a database only if a measured query is slow.
   As a separate product, the dependency rules of this repo do not bind it. Keep
   the index derived and rebuildable from the git files, so switching later costs
   a re-index, not a migration.
5. **Name, repository, license.** If it is a separate product it needs its own
   repo and its own license decision. Nothing from the competition entry should
   be moved or relicensed without checking `DISCLOSURES.md`.
6. **Kill criteria in measurable form.** The operator's rule is "no benefit and
   no clear path forward". Because the benefit cannot be known without building,
   time-box the trial. A proposal, not agreed: after four weeks of use, if the
   operator looked something up while actioning a signal fewer than a few times a
   week and cannot name the next improvement, stop. Confirm or change these numbers.
7. **Remaining questions from `requirements.md`:** which kinds are worth keeping
   first, which metadata each adapter keeps (not yet inventoried), attachment
   limits, sanitizing rules, and run caps.

## How to resume

1. Check that the competition has been submitted and `DIRECTION.md` is current.
2. Answer "Not decided" 1 and 2 first. They decide what stays in this repo.
3. Split `requirements.md`: what mind must provide (the export, and optionally
   the recall hook) stays here as a small spec. The rest moves to the new
   product's repo.
4. Build search first (FTS5), measure it, then add vectors and questions.
   Record where keyword search fails; that is the reason to add embeddings.
5. Open GitHub issues from `tasks.md` at that point. No issue exists yet.
   (`docs.md`: tasks and issues, not new TODO files.)

## What is not recorded here

No real addresses, messages, or IPs. Examples in the spec files are synthetic.
