# Direction

**Written 2026-11-18.** `PLAN.md` is the design; `references.md` is where the
ideas came from; this file is the bet — what this project claims, what it
refuses to do, and how the claim can be proved wrong.

## 1. The claim

`mind` is not an inbox client. It is a **policy layer** over the channels a
person is reachable on: mail, calendar, pull requests, SMS.

The bet, in one sentence: *most of what arrives can be answered by reviewable
rules the person wrote, and the share that can be is measurable.*

So the product metric is not "messages handled". It is:

> **absorb rate** — absorbed signals ÷ all signals — **plotted against the
> number of Directions in force.**

A tool that reorganises the flood looks successful as volume grows. This one
only looks successful if the line goes up as coverage grows, and it is designed
to fail visibly when it does not.

Everything below follows from that. If the curve stays flat while Directions
multiply, the thesis is wrong: say so in the write-up, do not tune the prompts
until the number moves.

## 2. What we will not build

Restraint is the strategy, not a limitation:

- **No chat interface.** Prompting is the attention cost being removed.
- **No inbox reorganisation** — no labels, no archive, no unread counts.
  Inbox Zero does that better than this ever will.
- **No badges, counters, or push.** Absence is the feature.
- **No multi-user, no sync, no hosted mode.** One process, one SQLite file.
- **No connector breadth for its own sake.** Four sources, done properly, beat
  twenty stubs. Teams was removed rather than worked around.
- **No embeddings or memory graph** while retention-plus-FTS5 is unproven.

## 3. The five moves

These are the specific ways this project differentiates itself from the prior
art in `references.md`, in order of how much they are worth.

| # | Move | Why it is the wedge | State |
| --- | --- | --- | --- |
| 1 | **Publish a curve that can fail** — absorb rate per week vs Directions in force, answered-but-unanswered reported separately | Nobody else reports a metric that can go down. `GET /metrics/coverage`, `mind coverage`, and the `handled` half of the brief | **Shipped** (needs a live week to be credible) |
| 2 | **Policy is code** — Directions are YAML in git; a rule can be dry-run before it is enabled | Diffable, revertible, portable, and reviewable in a pull request. Prior art keeps rules  in a database or a vendor UI | **Shipped**: `POST /directions/preview`, `mind preview` |
| 3 | **One ledger across channels a mail app cannot follow** — mail + calendar + PRs + SMS | Inbox Zero structurally cannot enter Google Messages; a PR review request is invisible to every mail tool | **Shipped**: `github` adapter added; SMS via the Matrix bridge |
| 4 | **Uncertainty as a first-class state** — `disputed` Thoughts carry the blocker instead of producing a plausible wrong draft | Competitors resolve ambiguity silently. "I don't know, and here is what would settle it" is the trust posture the send gates already imply | **Shipped**: `decide()` `disputed` path, `thoughts.disputedReason` |
| 5 | **A reproducible eval** — fixture stream + recorded model output → absorb/override report in CI | No prior art in this space has an evaluation story. It is also how moves 1 and 2 get checked before real traffic | **Planned** (P7) |

Two supporting mechanisms, borrowed and now load-bearing:

- **Commitments are state machines.** A later message supersedes an earlier
  promise (`previousStates`, `supersededBy`) instead of competing with it. Two
  competing reminder dates is the failure an attention tool cannot survive.
- **Reply tracking is two-sided.** A send counts as absorbed only when the other
  side answers; `absorbedUnanswered` is reported rather than hidden.

## 4. How it gets measured

**Week 1 — observe only.** Real accounts, `MIND_SEND_ENABLED` unset, every
Direction at `autonomy: observe`. Look at:

- absorb rate on **explicit** Directions only — the catch-all is excluded,
  because "the catch-all matched everything" is not coverage (STATUS gap #8);
- `absorbedUnanswered` — a rising absorb rate with a rising unanswered count
  means the tool is answering into a void;
- override rate per Direction — above 20% with five decided actions auto-disables
  the Direction, and that is a signal about the `standard`, not the model.

**Week 2 — one Direction at `draft`.** The one with real volume and a standard
written tightly enough to grade against. Approve or discard each draft. The
first learning-loop proposal should come from that data.

**What success looks like by 2026-12-04:** an explicit-Direction absorb rate at
or above 60% on at least one real channel, with an override rate under 20%, and
a published curve — even if the curve is flat.

**What failure looks like:** absorb rate flat or falling as Directions grow,
override rate climbing, or `absorbedUnanswered` tracking absorption one-for-one.
Any of those gets written down as the result.

## 5. Live testing

`LIVE.md` is the runbook. The order is deliberate: calendar (read-only, no
consequence) → Gmail **observe** → GitHub PRs → SMS. Nothing is sent until a
draft is approved in the Queue, and `mind doctor` says what is still missing.

## 6. Sequence

**Now (this round):** the model layer — commitments, disputed state, reply
tracking, preview, coverage, undo, explain, GitHub adapter. Specs and status
updated to match.

**Next:** eval harness (move 5), Direction grouping in the Thoughts tree, the
`filed` disposition decision (STATUS gap #3), and the adapter contract suite
(STATUS gap #1) — which matters more now that there are four sources.

**Deferred:** FTS5 retrieval, Android client, remote authentication, second
model provider verification.

## 7. Risks

| Risk | What it would look like | Response |
| --- | --- | --- |
| The curve is flat | Directions grow, absorb rate does not | Report it; narrow the claim to "policy layer + audit", drop the ratio language |
| A wrong auto-send | Any send that should not have happened | `MIND_SEND_ENABLED` stays off during live testing; approval is the only send path; `mind pause` is instant |
| GitHub noise | Every push re-signals the same PR | One signal per (PR, reason); `emitted` set per process + dedupe key per signal |
| SMS bridge is unofficial | Terms or breakage | It is a self-hosted Matrix bridge; adapter isolated behind the contract, observe-only until it proves stable |
| Measurement becomes vanity | Reporting totals instead of the curve | The brief reports the `handled` half, not a count of messages |
| Prior art discovered late | A judge finds Inbox Zero first | `references.md` discloses it up front, with what was and was not taken |

## 8. Done, for the write-up

1. The problem in one paragraph, without the word "AI" in the first sentence.
2. The claim, with the curve as evidence — including a week where it did not move.
3. What is deliberately not built (§2).
4. Where the ideas came from, linking `references.md`; no claim of invention.
5. The unverified list, from `STATUS.md`, unedited.
6. Kiro's role: which steering files shaped the work, which spec produced this
   round, which hooks ran.
