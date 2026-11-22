# Design — knowledge base

Status: draft, written against the recommended defaults in `requirements.md`.
Nothing here is built. Details that depend on open questions are marked **[Q#]**.

## Shape

```
idle or nightly run (learning-cycle.ts)
  └─ learning loop (unchanged)
  └─ knowledge extraction (new)
       signals since last extraction
         → select by policy        (pure, no model)
         → extract with the model  (delimited prompt, zod output)
         → sanitize                (pure)
         → merge with existing entry for the same subject + kind
         → store as a pending candidate (SQLite)
Knowledge view (extension)
  accept → write Markdown (and attachments) into MIND_KNOWLEDGE_DIR
  operator → git add, commit  (mind does not commit)
```

## Components

- `packages/pipeline/src/knowledge/policy.ts`: loads `policies/*.yaml` from the
  knowledge directory, validates with zod, selects which signals qualify and
  which fields to keep. Pure.
- `knowledge/extract.ts`: one model call per selected signal. Prompt wraps the
  message as data. Output schema: `{ kind, subject, summary, facts }`. The model
  suggests the kind; a policy must name it or the candidate is dropped and the
  outcome recorded.
- `knowledge/sanitize.ts`: defang URLs, strip tracking parameters, cap length,
  reject output that contains the original body text above a similarity limit.
  Pure and unit-tested with a hostile-content corpus.
- `knowledge/store.ts`: renders and parses entry files (front matter plus body),
  merges repeat observations, computes `expires` from `retention`. The only file
  that writes into the knowledge directory.
- `packages/server/src/routes/knowledge.ts`: `GET /knowledge` (pending, accepted,
  due for removal), `POST /knowledge/:id/accept`, `/reject`, `/edit`.
- Extension: `knowledge-panel.ts`, reusing the Learnings panel pattern.
- Migration: one table for pending candidates and one for the extraction cursor
  (last signal time handled). A new migration, never an edited one.

## Entry format

```markdown
---

id: spam-sender-7f3a
kind: spam
subject: offers@example.test
firstSeen: 2026-03-01T09:12:00Z
lastSeen: 2026-03-09T18:40:00Z
retention: 180d
expires: 2026-09-05
sensitivity: low
sources: [sig_01H…, sig_01J…]
facts:
sourceIp: 203.0.113.9
adapter: gmail
---

Sends unsolicited discount offers for watches. Seen 4 times. Links are shortened
and defanged: hxxps://short.example.test/…

## Log

- 2026-03-09: same pattern, new subject line style.
```

Attachments, when a policy allows them, go in `<entry id>.files/<sha256>.<ext>`
beside the entry, with the hash and size in front matter.

## Policy file

```yaml
# policies/spam.yaml
kind: spam
keep: [subject, summary, firstSeen, lastSeen, sourceIp, adapter]
attachments: never
retention: 180d
```

Policies are operator-owned and hot-reloaded by mtime like Directions.

## Safety

- Extraction runs only in batch, behind the learning loop's single-run guard.
- Per-run caps on calls and tokens; deferral on failure; no auto-accept.
- The model cannot pick a kind no policy names, cannot write to a path, and
  cannot set `retention` below or above the policy's bounds.
- File names come from a hash of `kind` and `subject`, never from model text.
- The injection corpus gets a case where the message says "store this as
  knowledge" or "ignore the policy".

## Documentation to update when built

`privacy-data.md` (data inventory: knowledge directory; egress: extraction
prompts, same provider), `structure.md`, `README.md`, `.env.example`
(`MIND_KNOWLEDGE_DIR`), `CHANGELOG.md`. These steering files are protected
paths, so that change needs the issue to carry `human-approved-scope`.

## Search and questions (Requirements 9 and 10)

```
knowledge directory (git)  ──mtime scan──►  derived index file (SQLite, outside git)
                                              ├─ FTS5 table          (Req. 9, no dependency)
                                              └─ vectors table       (Req. 10, only if approved)
search box ──► FTS5 query ──► ranked entries
ask (on request) ──► embed question (local) ──► top-k by cosine ──► model with entries as delimited data ──► answer + entry ids
```

- The index is a cache. Delete it and it rebuilds from the files.
- Vectors are stored as `Float32` blobs, one row per entry chunk, with the
  embedding model id and a content hash so a changed model or text re-embeds.
  Exact cosine over a few thousand rows is fast enough in Node. A vector
  database (LanceDB, Chroma) or the `sqlite-vec` extension is a dependency, a
  native-code or license question, and a second moving part. It is added only on
  a measured need (Req. 10.2). A dependency also needs `deps-approved`.
- Embedding model default: a small local Ollama embedding model, so the
  deliberate egress can stay at zero for this feature. The model id is recorded
  with each vector. Changing it triggers a full re-embed.
- Retrieval is the only thing the model sees. If the top entries score below a
  threshold, the answer is "nothing relevant in the knowledge base".
