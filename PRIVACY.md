# Privacy policy

_Draft, not legal advice. Last updated: 2026-11-27._

mind is software you run yourself. It is not a hosted service. The author does not
operate a server that receives your data, has no accounts, and has no access to
anything you process with it. This page says what the software does with your data on
your own machine.

## Who is responsible

You are. You run mind, you choose which accounts to connect, and you choose which
model provider receives message text. The author of the software is Walter White
(see `LICENSE`). Security reports go through
<https://github.com/walterjwhite/kIiYOSJe/security/advisories/new>.

## What mind reads

Only accounts you connect, using credentials you supply:

| Source          | What is read                                    | Access requested                                   |
| --------------- | ----------------------------------------------- | -------------------------------------------------- |
| Gmail           | Unread mail from the last day, then new mail    | `gmail.modify` (read, drafts, send, move to Trash) |
| Google Calendar | Events                                          | `calendar`                                         |
| GitHub          | Pull requests and issues that involve you       | A personal access token you create                 |
| Jira            | Issues (read-only)                              | An API token you create                            |
| Outlook         | Mail and drafts through Microsoft Graph         | An app registration you create                     |
| SMS             | Messages from a Google Messages bridge you host | A bridge token you create                          |

Each source stays idle until its credentials exist. Nothing is bundled and nothing is
shared between installs. You can revoke access at the provider at any time, and mind
then reports that source as "not configured".

## Where data is stored

Everything is stored on your machine:

- Messages, decisions, and events: one SQLite file in the data directory.
- Directions, learnings, settings, and credentials: files under
  `~/.config/kIiYOSJe/mind/`. Credentials and the API token are mode 600.
- Backups and snapshots: `backups/` and `snapshots/`. They contain message content.

mind does not encrypt data at rest. It relies on file permissions and on any disk
encryption you provide.

## What leaves your machine

Only one thing leaves by design: the text of a message, sent to the model provider you
configure, so it can be classified and replies can be drafted. The default provider is
Ollama running on your own machine, which means nothing leaves. If you choose a cloud
provider (for example OpenAI, Anthropic, Google, or a Copilot or Kiro CLI), that
provider receives the text and handles it under its own terms. Read those terms before
you enable it.

Prompts can also include your own learnings, goal answers, and short excerpts of
earlier messages from the same sender (about 300 characters each, up to 8). Do not put
secrets or real personal data in learnings.

Credentials go only to their own provider. mind has no telemetry, no analytics, and no
remote error reporting.

If you install an adapter pack, that pack is code you chose to run. mind cannot see
where it sends what it reads.

## Google user data

mind's use of information received from Google APIs follows the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including its Limited Use requirements.

- Gmail and Calendar data is used only to show you your own signals, draft replies, and
  perform actions you or your own Directions authorize.
- It is not sold, not used for advertising, and not used to train a model by the
  author. If you point mind at a cloud model provider, that provider's terms apply to
  the text you send it.
- Humans do not read it. The author has no access to it. Message text is read by the
  model you configure.
- Sending mail and moving mail to Trash are off by default. Each needs its own switch
  and your Direction's permission. Approving a draft yourself is the only other way a
  message is sent.

## Retention and deletion

- Message bodies are replaced with a redaction marker after 30 days
  (`MIND_RETENTION_DAYS`). Sender, subject, summary, decisions, and events remain.
- `mind export` writes a copy of your data to a file you choose.
- `mind purge` deletes the database, status file, and caches. `mind purge --all` also
  deletes backups and snapshots.
- Revoking access at Google, GitHub, or another provider stops mind reading from it.
  Delete the credentials file to remove the stored tokens.

## Logs

Logs record ids, counts, durations, and adapter names. They do not record message
bodies, subjects, addresses, prompts, model replies, or tokens.

## Children

mind is not directed at children.

## Changes

Changes to this page appear in `CHANGELOG.md` and the git history.

## Contact

Use the private reporting link above for security issues. For anything else, open an
issue at <https://github.com/walterjwhite/kIiYOSJe/issues>.
