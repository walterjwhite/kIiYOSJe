---
inclusion: auto
---

# Competition perspective

The repo is judged as a hackathon entry, not only as software. Optimize for what
a reviewer can verify in ten minutes: a public repo, a visible license, a `/.kiro`
folder that reads like real work, a demo that runs, and a write-up that claims
nothing it cannot show.

## What earns points

| Criterion | Where it lives | How to strengthen it |
| --- | --- | --- |
| Originality | the Thought-vs-signal thesis; the ratio metric | keep the thesis in the first paragraph of the README; do not describe it as "an AI inbox" |
| Depth of Kiro use | `.kiro/steering`, `.kiro/specs`, `.kiro/hooks` | specs must match shipped code; tasks must be honestly checked; hooks must run what the docs say |
| Execution | 150 tests, typed boundaries, real SQLite, VS Code client | keep `npm test` and `npx tsc --build` green at all times |
| Feasibility | single process, one SQLite file, local-first, Ollama default | state the resource footprint and the one egress path |
| Demo | the seeded `demo-data` personas | demo the Queue, not the code; show a send being refused by a gate |
| Honesty | non-goals, unverified adapters, open decisions | disclose gaps before a judge finds them |

## Rules that disqualify

- Repo is private, or the license is not detectable in the About panel.
- `/` contains no `.kiro` directory, or `.kiro` is gitignored, or it is empty
  scaffolding that does not correspond to the code.
- Work predates the submission window (Oct 30 – Dec 4, 2026) or was not written
  by the entrant. Anything pre-existing must be disclosed.
- Third-party integrations used without authorization under the provider's terms.
- Video contains third-party trademarks, logos, or branded UI without permission.
- More than three teammates, or a claim of sole ownership that is not true.

## History hygiene

- Commit as work happens, across days. Author dates are evidence that the project
  was built inside the window.
- Do not squash the history into one commit before submitting: it collapses the
  dates and removes the only timeline a judge can inspect.
- Do not backdate, and do not rewrite authorship to hide a contributor. Rewriting
  a duplicate identity that is the same person is fine; rewriting someone else's
  authorship is falsification.
- `.kiro` specs and the commit log should tell the same story. If a spec claims a
  task is done, the diff that did it should be findable.

## Video and screenshots

- No product logos, no branded inbox screenshots, no vendor icons in thumbnails.
- Product names in narration or captions ("imports Gmail") are nominative and fine.
- Use only audio and footage you own; a silent screen recording beats licensed music.
- Show the Kiro loop: a spec, a task, a hook firing, the resulting diff. That is
  the part judges cannot get from the README.

## Write-up shape

1. The problem in one paragraph, without the word "AI" in the first sentence.
2. What it does, as a sequence of screens the judge will see in the video.
3. What is deliberately not built — the non-goals — because restraint reads as intent.
4. How Kiro was used, concretely: which steering files, which specs, which hooks.
5. Integrations and their authorization basis; the one egress path.
6. What is unverified, with the reason.

## Pre-submission check

```bash
npm test && npx tsc --build --pretty false   # green
npm run license:check                        # no denied licenses
git check-ignore -v .kiro/steering/product.md >/dev/null && echo "DISQUALIFYING" || echo "ok: .kiro tracked"
git ls-files .kiro | head                    # .kiro is committed, not ignored
git log --format='%ae' | sort -u             # one identity per real person
```

Also confirm: repo public, license in About, README opened in a private window to
check it renders without local files, and the demo runs from a clean clone.
