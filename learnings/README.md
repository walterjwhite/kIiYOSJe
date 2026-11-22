# Learnings

A learning is a short note, in plain language, about how mind should judge or
word things. Each `.md` file in this folder is one learning. mind adds the text
to the prompt the classifier and the drafter see, so you can edit a note, commit
it, and review the change in git like any other file.

This `README.md` is not loaded. An empty folder changes nothing: with no
learnings, prompts are exactly what they were before.

## Format

```markdown
---
title: Vendor renewals
applies: both
direction: work/vendors
enabled: true
---

Renewal notices under $500 are routine. Treat anything larger as needing my
decision, even if the sender is a vendor I know.
```

Every front matter field is optional. The front matter itself is optional.

| Field       | Values                       | Default                  | Meaning                                         |
| ----------- | ---------------------------- | ------------------------ | ----------------------------------------------- |
| `title`     | text, up to 120 characters   | the file name            | Shown in the Learnings view                     |
| `applies`   | `classify`, `draft`, `both`  | `both`                   | Which model call sees it                        |
| `direction` | a Direction id, e.g. `work/vendors` | every Direction   | Only used when that Direction matched           |
| `enabled`   | `true`, `false`              | `true`                   | Turn a note off without deleting it             |

Subfolders are allowed. A file's id is its path without `.md`.

## Limits

- 1,500 characters per file. Longer files are skipped; split them.
- 4,000 characters in total per model call. Files past that are left out and a
  warning is logged. Small local models have small context windows, so short
  notes work best.
- A file with invalid front matter or no text is skipped. The Learnings view
  lists it with the reason.

## What a learning can and cannot do

It can change how a message is classified (urgency, whether it needs you, what
counts as a commitment) and how a draft is worded.

It cannot allow a send, pick a recipient, or change a Direction. Posture,
autonomy and the send gates are decided in code. The text is placed in the
prompt inside `<learnings>` tags, marked as the operator's preferences.

## Privacy

Learnings are sent to the configured model provider with every classify or draft
call they apply to. With the default local Ollama model that stays on your
machine. If you use a cloud provider, do not put anything in a learning you would
not send to it. Do not put credentials, real names or message content here if
you commit this folder to a public repository.

## Examples

`tone.md`: how drafts should sound.

```markdown
---
title: Tone
applies: draft
---

Short and warm. No exclamation marks. Never promise a date I did not give.
```

`newsletters.md`: how to judge a kind of mail.

```markdown
---
title: Newsletters
applies: classify
---

Anything with an unsubscribe link and no question for me is information, low
urgency, nothing to answer.
```

## Seeing what was used

Each processed signal's audit event (`signal.processed`) lists the ids of the
learnings used for classify and for draft. It records ids only, not text.
