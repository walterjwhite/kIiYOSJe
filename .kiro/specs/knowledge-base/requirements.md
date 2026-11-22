# Requirements — knowledge base

Status: parked until after 2026-12-04, and likely a separate product. Read
`HANDOFF.md` first: it records the decisions and what is still open, and wins
where this file disagrees. Not built.
Read `DIRECTION.md` first: section "Alignment with DIRECTION.md" below says where
this feature fits the bet and where it deviates, and what has to change before
the deviating parts are built.

## Introduction

The learning loop proposes changes to Directions. The knowledge base is a
separate thing: durable, local, human-reviewed notes that mind distills from
signals, stored as Markdown in git. It is independent of Directions and of the
signals it came from.

The principle is that most signals leave nothing behind. A signal becomes
knowledge only when a policy says it is worth keeping, and only the part worth
keeping is kept. Example: for spam, keep the sender address, a sanitized summary
of what that sender sends, and the facts that help recognize it again (first and
last seen, source IP when the adapter provides it). Do not keep the body.

Operator decisions already made (from the issue discussion):

- Sending private signal text to the configured cloud model provider is
  acceptable to the operator. The knowledge base adds a new use of that same
  egress, not a new destination (see Requirement 7).
- Knowledge is independent of Directions.
- Knowledge is Markdown, stored in git, with related files (attachments) stored
  next to it.
- Retention is independent of the source signal. Different kinds of knowledge
  carry or suggest different retention periods.
- The operator reviews, approves, and commits. mind does not publish knowledge
  by itself.
- Deleting expired knowledge from the working tree is fine even though git
  history keeps it. The working tree is what is important now; history shows how
  it got there. No history rewriting.
- The knowledge base is for the operator only. Nothing is fed back into
  classifier or drafter prompts in version 1.
- The operator wants to search the knowledge base, and ask questions against it
  (retrieval-augmented generation), with any vector store kept local.

## Requirement 1 — Not everything becomes knowledge

1. The system SHALL create no knowledge for a signal unless a knowledge policy
   selects it. With no policy, nothing is stored.
2. A policy SHALL say, per kind of signal (for example `spam`, `newsletter`,
   `receipt`, `thread-decision`), whether to keep knowledge, which fields to
   keep, whether attachments are kept, and the suggested retention.
3. Each candidate SHALL record why it was selected (the policy and kind), so the
   reviewer sees why it exists.

## Requirement 2 — What a knowledge entry contains

1. An entry SHALL be a Markdown file with YAML front matter: `id`, `kind`,
   `subject` (the entity it is about, such as a sender address), `firstSeen`,
   `lastSeen`, `retention`, `expires` (derived), `sources` (signal ids only), and
   `sensitivity`.
2. The body SHALL be a sanitized summary written for a human. It SHALL NOT quote
   the message body, and SHALL NOT contain executable links: URLs are defanged.
3. Metadata the policy asks for (date and time, source IP, adapter, account
   label) SHALL be stored as front matter fields when the adapter provides them,
   and omitted when it does not.
4. A repeat observation about the same `subject` and `kind` SHALL update the
   existing entry (`lastSeen`, a dated line in a log section), not create a
   second file.

## Requirement 3 — Attachments

1. Attachments SHALL be kept only when the policy says so for that kind. The
   default for every kind is not to keep them.
2. A kept attachment SHALL be stored next to its entry, with its SHA-256,
   media type, and size in front matter. Size SHALL be capped per file and per
   entry (limits are settings, defaults open).
3. Attachments from signals classified as spam or from unknown senders SHALL NOT
   be stored, whatever the policy says.
4. Mind SHALL never open, render, or execute a stored attachment.

## Requirement 4 — Independent retention

1. Deleting or expiring a signal SHALL NOT delete knowledge derived from it.
   Deleting knowledge SHALL NOT delete signals.
2. Each entry SHALL carry its own retention. The policy suggests a period per
   kind. The operator MAY change it during review.
3. Entries past `expires` SHALL be listed for removal in the review screen. mind
   SHALL NOT delete a reviewed entry without the operator accepting the removal.
4. The docs SHALL state that removing a file leaves it in git history (see open
   question 6).

## Requirement 5 — Review, approval, and commit

1. New and changed entries SHALL start as pending candidates. Nothing reaches the
   knowledge directory until the operator accepts it.
2. The operator SHALL be able to accept, edit then accept, or reject each
   candidate in the extension. A rejected candidate SHALL suppress an identical
   one for a configurable period.
3. mind SHALL NOT run `git commit` or `git push` itself in the first version.
   Accepting writes the files; the operator commits. (Open question 2 may change
   how review is presented, not who commits.)
4. Accepting SHALL be idempotent and recorded as an event with ids and decision
   only, no content.

## Requirement 6 — When it runs

1. Knowledge extraction SHALL run in the batch of the learning loop's idle and
   nightly runs, over signals received since the last extraction. It SHALL NOT
   add a model call to the live ingest path.
2. A run SHALL have a per-run model call cap and a token cap. When a cap is
   reached, the remaining signals wait for the next run. Nothing is dropped.
3. A model failure SHALL defer the signal and record why. It SHALL NOT create
   knowledge from a failed or invalid response.
4. Output SHALL be parsed against a zod schema. A parse failure is a recorded
   outcome.

## Requirement 7 — Privacy and safety

1. Signal text sent for extraction goes only to the model provider the operator
   already configured, under the same egress rule as classify and draft.
   `privacy-data.md` SHALL be updated to name this use when the feature ships.
2. Message text is data. It SHALL be delimited in the extraction prompt and
   covered by the injection corpus. Model output SHALL NOT change a Direction,
   send gate, autonomy, or recipient.
3. Because knowledge persists, sanitization SHALL run on model output before it
   is shown for review, and the reviewer sees exactly what would be written.
4. Knowledge SHALL NOT be added to classifier or drafter prompts in the first
   version. Any later use SHALL be a deterministic lookup (for example, known
   spam sender) with its own requirement, not free text in prompts.
5. Knowledge SHALL NOT be committed to this public repository. The directory is
   operator-configured and defaults to a path outside the repo (open question 1).
6. Logs, metrics, and errors SHALL NOT contain knowledge text, subjects, or
   addresses.

## Requirement 8 — Visible, local, cheap

1. The extension SHALL show a Knowledge view: pending candidates, accepted
   entries by kind, and entries due for removal. It SHALL add no badge, counter,
   or notification.
2. The Knowledge view SHALL read from the knowledge directory, not from a private
   copy.
3. `GET /metrics` MAY report candidates created, accepted, rejected, and tokens
   used by extraction, so the cost of the feature is visible.

## Requirement 9 — Search the knowledge base

1. The Knowledge view SHALL search entries by keyword using SQLite FTS5, over
   `subject`, `kind`, `facts`, and the summary.
2. The search index SHALL be derived from the knowledge directory, stored outside
   it, and rebuildable. Deleting the index SHALL lose nothing.
3. The index SHALL update when entries are accepted, edited, or removed, and when
   the directory changes outside mind (for example after `git pull`), detected by
   mtime.
4. Search SHALL make no model call and send nothing off the machine.
5. FTS5 is built into SQLite. This requirement SHALL add no dependency.

## Requirement 10 — Semantic search and questions (conditional)

This requirement is built only after the conditions in "Alignment with
DIRECTION.md" are met. It records the intended shape so the decision can be made
on facts.

1. Semantic search SHALL use embeddings computed locally by default (Ollama).
   Sending knowledge text to a cloud embedding provider SHALL require the
   operator to choose it in config, and the config SHALL name it.
2. The vector index SHALL live in a derived, rebuildable file next to the FTS
   index, never in the knowledge directory or in git. For a personal knowledge
   base (thousands of entries) the first implementation SHALL be exact search
   over stored vectors in SQLite. A vector database or SQLite extension SHALL be
   added only when a measured query over the real knowledge base exceeds 100 ms.
3. WHEN the operator asks a question THEN the system SHALL retrieve the top
   entries, pass them as delimited data to the configured model, and answer
   with citations to entry ids. It SHALL say so when nothing relevant is found,
   and SHALL NOT answer from the model's general knowledge.
4. Asking SHALL happen only on request, from a command or the Knowledge view. It
   SHALL NOT be a chat that keeps a history, push anything, or run on a timer.
5. An answer SHALL never trigger a send, change a Direction, or write to the
   knowledge directory.
6. Retrieval quality SHALL be measured on a labelled synthetic set before the
   feature is called useful, and FTS5 SHALL be the baseline it must beat
   (`ai-quality.md`).

## Alignment with DIRECTION.md

`DIRECTION.md` is the project's guiding document. It states the claim, the
refusals, and the order of work. `product.md` repeats the thesis and non-goals.
This spec was checked against both.

| Part of this feature                                          | Verdict                                     | Why                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy-selected, reviewed, git-stored knowledge (Req. 1 to 8) | Reasonable, but only if it feeds the metric | The claim is the absorb rate against Directions in force. A knowledge base the operator only reads does not move that number. It earns its place if known-sender entries later let the pipeline absorb signals without a model call (task 14). Until then it is a notes tool beside the product, and should be labelled that way. |
| Keyword search over knowledge (Req. 9)                        | Fits                                        | `DIRECTION.md` defers FTS5 retrieval and `PLAN.md` says "FTS5 first". This is that step, on the smaller corpus where it is cheap to prove. It uses no new dependency.                                                                                                                                                             |
| Embeddings and a vector store (Req. 10.1, 10.2)               | Deviates                                    | `DIRECTION.md` section 2: "No embeddings or memory graph while retention-plus-FTS5 is unproven." `PLAN.md` P6: "embeddings only if FTS5 proves insufficient". The condition is not met yet.                                                                                                                                       |
| Asking questions (Req. 10.3 to 10.5)                          | Deviates                                    | `DIRECTION.md` section 2: "No chat interface. Prompting is the attention cost being removed." `product.md`: "Not a chat assistant that has to be prompted." A one-shot, on-request lookup is narrower than a chat, but it is still prompting.                                                                                     |
| Timing                                                        | Risk                                        | Today is 2026-11-22. The submission window closes 2026-12-04. `DIRECTION.md` section 6 lists the eval harness, the adapter contract suite, and a live observe week as next. None is done (see `STATUS.md`).                                                                                                                       |

Conclusion: the capture-and-review half is a reasonable extension if it is tied to
the metric. Search is on the roadmap already. Embeddings and asking questions are
deliberate deviations. A deviation is allowed with a reason, so before building
them:

1. Write the reason in `DIRECTION.md` as a dated amendment: what changes in
   section 2 and why. Candidate reasons: the knowledge base is a corpus where
   FTS5 can be measured to be insufficient, and the operator wants it for
   their own research, not for the attention thesis.
2. Run the FTS5 baseline first (Requirement 9) and record where it fails.
3. Keep the deviation scoped: on-request, local, never in the ingest path,
   never feeding prompts.
4. Do not start before submission unless the operator decides the live week and
   eval harness can wait.

## Open questions

Each has a recommended default. If you reply "defaults", the design uses them.

1. **Where does knowledge live?** The operator's real spam senders, IP addresses,
   and summaries must not go into this public repository. Recommended: a separate
   private git repository at `MIND_KNOWLEDGE_DIR` (default
   `~/.local/share/kIiYOSJe/mind/knowledge`), which the operator runs
   `git init` in. Alternative: a `knowledge/` folder in this repo, which would
   need to be gitignored (a protected path) and loses the durability you want.
2. **"PRs".** A real pull request needs a hosted remote, a token, and an API call
   outside the declared egress. Options: (A) pending candidates live in mind's
   database and appear in the Knowledge view; accept writes files and you commit.
   (B) mind writes each batch to a local review branch in the knowledge
   repository and you merge it, using your usual diff tooling. (C) mind opens
   GitHub PRs. Recommended: A for version 1, B as a later option, C not planned.
3. **What is worth keeping, and who decides?** Recommended: default-deny, with
   operator-authored policies in `knowledge/policies/*.yaml` choosing kinds and
   fields. The model proposes the kind and writes the summary; it never decides
   to store something no policy names. Which kinds do you want first? Suggestion:
   `spam`, `newsletter`, and `sender-profile`.
4. **Which metadata?** Source IP and headers need the adapter to keep them.
   I have not yet checked what each adapter stores. Recommended: the design phase
   inventories what Gmail, Outlook, and gmessages provide, and policies may ask
   only for fields that exist.
5. **Attachments.** Recommended: never for spam or unknown senders, hash and
   metadata only for everything else by default, and a 5 MB per file and 25 MB
   per entry cap when a policy opts in. Binary files in git grow the repository
   permanently. Acceptable?
6. **Deletion and git history.** ANSWERED: fine. Git history is the record of how
   the current state came about. No history rewriting. The docs say so.
7. **Use of knowledge.** PARTLY ANSWERED: it is for the operator only. Search and
   questions are wanted (Requirements 9 and 10). Whether anything feeds back into
   the pipeline is still open. Recommended: version 1 is for you to read and search,
   with nothing fed back into prompts (Requirement 7.4). A later version may let
   the pipeline check a sender against known-spam entries without a model call.
   Is that the order you want?
8. **Granularity.** Recommended: one file per entity and kind (for example one
   file per spam sender), updated over time (Requirement 2.4), rather than one
   file per signal.
9. **Sanitizing.** Recommended: defang URLs (`hxxps://`), drop tracking
   parameters, never quote body text, cap the summary at 600 characters, and keep
   the sender address as-is because it is the point of the entry. Anything else
   to strip?
10. **Run caps.** Recommended defaults: 20 signals and 40,000 tokens per run.
    Your cloud tier's rate limits and any daily ceiling (`performance.md`) apply.
