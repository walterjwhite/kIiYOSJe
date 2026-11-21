---

## inclusion: auto

# Documentation

## Where things live

| Question                             | Document                                                 | Rule                                                                  |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| What is this and how do I run it?    | `README.md`                                              | thesis in the first paragraph; quickstart works from a clean checkout |
| What must it do?                     | `.kiro/specs/*/requirements.md`                          | authoritative; acceptance criteria are testable                       |
| How is it built?                     | `.kiro/specs/*/design.md`, `.kiro/steering/structure.md` | match shipped code                                                    |
| What is left?                        | `.kiro/specs/*/tasks.md` and GitHub Issues               | tasks checked honestly; issues for anything not done                  |
| What is the state?                   | `STATUS.md`                                              | one status document; no hard-coded test counts                        |
| What changed?                        | `CHANGELOG.md`                                           | every user-visible change                                             |
| How do I report a vulnerability?     | `SECURITY.md`                                            | private channel                                                       |
| What was borrowed or generated?      | `DISCLOSURES.md`                                         | file paths, honest                                                    |
| How do I contribute or run an agent? | `CONTRIBUTING.md`, `AGENTS.md`                           |                                                                       |

`PLAN.md`, `TODO.md`, `todo/`, and `LIVE.md` overlap with the above. Fold them
into specs and Issues (tracked in a docs issue); do not add new ones.

## Update rules

- Behavior change → update the spec's requirements or design in the same PR.
- New or changed config, env var, route, or CLI command → update the docs that
  name it and the data inventory in `privacy-data.md` when data is involved.
- New dependency → `npm run license:check`, and a NOTICE entry if Apache-2.0
  requires one.
- Claims need evidence. Say "implemented, unverified" until it ran against a live
  account. Do not claim provider verification, certification, or partnership.
- Do not describe the project as supporting Teams.

## Style

Plain language, short sentences, concrete numbers. Name the mechanism. Each
user-visible command and setting says what it does. Examples are copy-pasteable
and use fake values.
