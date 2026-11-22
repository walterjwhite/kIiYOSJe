---

## inclusion: auto

# Privacy and data handling

The operator's mail and messages are the product's raw material and its biggest
liability. Collect little, keep briefly, send out only what the one declared
egress needs, and let the operator delete or export everything.

## Data inventory

| Data                                 | Location                     | Retention                            | Leaves the machine?                                                                           |
| ------------------------------------ | ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Signals (normalized message content) | SQLite                       | `MIND_RETENTION_DAYS`                | Only the text of a signal in a classifier or drafting prompt to the configured model provider |
| Thoughts, actions, events            | SQLite                       | same as signals unless kept as audit | No                                                                                            |
| Directions                           | YAML under `directions/`     | operator-owned                       | No                                                                                            |
| Learnings                            | Markdown under `learnings/`  | operator-owned                       | Yes: the text of each applicable learning is added to classifier and drafting prompts         |
| Learning window                      | `learning.json` in config    | operator-owned                       | No                                                                                            |
| Credentials, token                   | `~/.config/kIiYOSJe/mind/`   | until revoked                        | Credentials go only to their own provider                                                     |
| Logs                                 | stdout / operator's log sink | operator-owned                       | No, and contain no content                                                                    |
| Backups                              | operator-chosen path         | operator-owned                       | No                                                                                            |

Keep this table current whenever a column, file, or adapter is added.

## Rules

1. **One deliberate egress:** classifier and drafting calls to the configured
   model provider. It must stay visible in config. Local Ollama is the default so
   egress can be zero. Any other outbound call needs a spec and an explicit
   decision.
2. **Minimize prompt content.** Strip quoted history and signatures, truncate,
   and include only fields the task needs. Learnings are capped at 4,000 characters
   per call and are the operator's own text; the docs warn against secrets and real
   personal data in them. Never include credentials, other
   people's addresses beyond the thread, or attachments unless a Direction needs them.
3. **No content in logs, errors, metrics, or issue reports.** Error messages the
   operator may paste into a bug must be safe by construction.
4. **Retention is enforced,** not advisory. The default is finite. Deleting a
   signal deletes derived content; audit rows keep ids and decisions only.
5. **Operator controls:** `mind export`, `mind purge`, backup, and restore exist
   and are tested. Purge removes the database, status file, and caches.
6. **Provider terms:** before enabling a cloud model, the operator should know
   the provider's data-use terms. Docs state which providers receive content.
7. **Fixtures and demo data are synthetic.** Never commit real messages, names,
   or addresses, including in screenshots and the demo video.
8. **Backups inherit sensitivity.** Created with mode 600; the docs say they
   contain message content.
9. **Multi-user is not supported.** Do not add shared-state features without the
   ownership decision recorded.
10. Do not describe the project as encrypting data at rest unless it does.
    The honest statement today: protected by file permissions and disk encryption
    the operator provides.
