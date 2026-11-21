# Live testing

Running `mind` against your own accounts. The goal of the first week is **data,
not automation**: every Direction stays at `autonomy: observe`, nothing is sent,
and the point is to see what actually arrives and what the curve looks like.

Check readiness at any point with:

```bash
node packages/cli/dist/index.js doctor     # or: mind doctor, once linked
```

`doctor` is read-only. It never creates credentials and never sends.

## 0. Safety, before anything else

```bash
export MIND_SEND_ENABLED=false   # the default; be explicit anyway
mind pause                       # optional hard stop for all sends
```

- A send needs **all** of: the adapter can send, the Direction says
  `autonomy: send`, `MIND_SEND_ENABLED=true`, no guard fired, and no pause flag.
- Approving a draft in the Queue is the only human send path. `mind pause`
  blocks it too (HTTP 423).
- Keep every Direction at `autonomy: observe` or `draft` for the first week.
  `observe` records what it _would_ have done and writes no draft.
- Full message bodies are kept 30 days (`MIND_RETENTION_DAYS`), then redacted
  to sender + disposition + match. Set it lower if that matters to you.
- The only network egress is the model call. Ollama is the default and keeps it
  at zero; a cloud provider is a deliberate choice.

## 1. Credentials

Everything goes in `~/.config/kIiYOSJe/mind/credentials.yml`, mode `600`. Every
adapter degrades to "not configured" rather than failing startup, so you can add
sources one at a time. Environment variables win over the file and are listed
next to each section.

```yaml
google: # Gmail + Google Calendar share one token
  clientId: "..."
  clientSecret: "..."
  refreshToken: "..." # the default account
  accounts: # optional: more accounts, same OAuth client
    - label: work
      address: you@work.example
      refreshToken: "..."
    - label: personal
      address: you@personal.example
      refreshToken: "..."

outlook: # optional; same account shape
  tenantId: "..."
  clientId: "..."
  clientSecret: "..."
  accounts:
    - label: work
      address: you@work.example
      refreshToken: "..."

github:
  token: "github_pat_..." # fine-grained PAT: metadata + pull requests (read)
  accounts: # optional: one adapter per token
    - label: work
      token: "github_pat_..."

gmessages: # SMS via a self-hosted Matrix bridge
  homeserverUrl: "http://localhost:8008"
  accessToken: "..."
  userId: "@you:localhost"
  accounts: # optional: one bridge login per phone line
    - label: second-line
      accessToken: "..."
      userId: "@you2:localhost"

operator:
  addresses: # extra "me" addresses; account addresses join this
    - you@example.com
    - "+15551234567"
```

Every source accepts an `accounts:` list. The flat block stays the `default`
account, and everything outside `accounts` (an OAuth client id/secret, the
Matrix homeserver, a GitHub API base) is shared by every account. Give each
account a `label` and, for mail or SMS, the `address` it owns. The label is
part of the adapter id (`gmail`, `gmail:work`), is recorded on each signal, and
decides which mailbox a reply is sent from. Account `address` values are added
to the "me" list automatically.

Mail is deduplicated on the `Message-ID` header, so a message delivered to two
of your mailboxes is one signal rather than two.

Env equivalents still fill the `default` account only: `MIND_GOOGLE_CLIENT_ID`,
`MIND_GOOGLE_CLIENT_SECRET`, `MIND_GOOGLE_REFRESH_TOKEN`, `GITHUB_TOKEN`,
`MIND_GMESSAGES_*`.

`operator.addresses` is not cosmetic. Two-sided reply tracking ignores signals
from these addresses when deciding whether a wait has been answered; without it
your own sent mail would look like a reply.

## 2. Gmail

OAuth scopes: `gmail.modify` (read + drafts). The adapter polls
`is:unread newer_than:1d`, so the first tick backfills a day of unread mail.

1. Create an OAuth client (desktop) in a Google Cloud project, enable the Gmail
   API, and authorise the scopes in `packages/adapters/src/google/auth.ts`.
   Then let the mailboxes in: Google Auth Platform → Audience → either add each
   address under **Test users**, or press **Publish app**. A new project starts
   in _Testing_, where any address not on the test list is refused with
   `Error 403: access_denied` before a code is ever issued — that is the block,
   not a client or redirect problem. Testing also expires refresh tokens after
   7 days, so for several personal mailboxes publish the app and click through
   the "Google hasn't verified this app" warning once per mailbox. Real
   verification is not worth it: `gmail.modify` is a _restricted_ scope, so it
   means a third-party security assessment.
2. Mint a refresh token: `scripts/google-refresh-token.sh --account you@gmail.com`.
   It runs the loopback consent flow (`access_type=offline` + `prompt=consent`),
   checks the result against the Gmail profile so a second mailbox cannot
   silently authorise the first, and prints the `google:` block — or writes it
   with `--write`. Run it once per mailbox: the first token fills the flat
   `refreshToken`, later ones append to `accounts`.
3. `mind doctor` should now say `ok gmail`.
4. Start with one narrow Direction (a sender you know, or a topic), `posture:
   absorb`, `autonomy: observe`. Read the Signals view for a day before adding
   another.

What "observe" means here: the signal is stored, classified, matched, and the
`signal.processed` event records what would have happened — but no draft is
written and no action exists to approve.

## 3. Google Calendar

Same Google token, scope `calendar` — or skip OAuth entirely and use private ICS
URLs (read-only). List every calendar you actually look at, across every
account, shared ones included: sources are merged, and a meeting that appears
on two calendars (even under two accounts) becomes one signal, not two.

```yaml
google:
  refreshToken: "..."

calendar:
  # Any number of Google calendars (id or email address) and/or ICS feeds.
  # `account` defaults to the flat google: account.
  sources:
    - primary
    - account: work
      google: team@work.example
    - ics: "https://calendar.google.com/calendar/ical/.../basic.ics"
      label: personal
      account: personal
  # Where a created event goes; defaults to the first Google source.
  # The string form uses the default account unless writeToAccount is set.
  writeTo:
    account: work
    calendar: team@work.example
```

A source that fails (revoked token, dead feed) is logged and skipped, and the
rest still arrive; if nothing at all could be read, the poll failure is logged
rather than swallowed. A meeting present on several calendars is collapsed by
start time and title, so the brief shows it once.

The older single-calendar keys still work — `calendar.calendarId` plus
`calendar.icsUrl`, with the feed used as a fallback when Google fails:

```yaml
calendar:
  calendarId: primary
  icsUrl: "https://calendar.google.com/calendar/ical/.../basic.ics"
```

Calendar events arrive as `event` signals with a title, start/end, and location.
They exist so the brief can show what is coming without any mail volume — not so
they can be replied to.

## 4. GitHub pull requests

A fine-grained PAT with **Metadata: read** and **Pull requests: read** is enough.
`canSend` is false for this adapter: no comment, no review, no merge is ever
written. The three searches it runs are:

- `is:pr is:open review-requested:<you>` — review requested
- `is:pr is:open assignee:<you>` — assigned to you
- `is:pr is:open author:<you> review:changes_requested` — changes requested on yours

Each (PR, reason) becomes one signal whose body has a `Reason:` line; the example
`directions/work/github-prs.yaml` matches on it with `posture: surface`. A review
request becomes a Thought to look at, not a draft to approve.

Known limitation, by design: the external id is stable per (PR, reason), so a PR
that goes quiet and comes back does not re-signal. Re-requesting review on the
same PR will not create a second signal until the process restarts. This is
preferable to re-signalling on every push; if it turns out to matter, key the id
on the review request id rather than the PR.

## 5. SMS (Google Messages via Matrix)

SMS arrives through a self-hosted [mautrix-gmessages](https://github.com/mautrix/gmessages)
bridge. It is AGPL-3.0 and runs as a separate service — `mind` talks to it over
the Matrix client-server API, so no AGPL code is linked into this tree.

1. Run the bridge against a local homeserver (Synapse or Dendrite), log in with
   your Google account, and bridge the DM rooms.
2. Create a bot/appservice user for `mind`, or reuse your own access token.
3. Put `homeserverUrl`, `accessToken`, and `userId` in `credentials.yml`.
4. Confirm `mind doctor` reports `ok sms`.

The adapter only keeps rooms the bridge marks as Google Messages rooms, and skips
events it sent itself. Inbound texts become signals with the room as the thread,
so a reply from the Queue goes back through the same room as an SMS.

If you are not running the bridge yet, the other three sources still work; SMS is
the one to add last.

## 6. Day one checklist

```bash
npm run dev          # in one terminal; leave it running
mind doctor          # in another
```

- [ ] `mind doctor` reports the sources you intend to use
- [ ] `curl` `/health` returns the adapter list (the extension does this for you)
- [ ] Every Direction is `observe` or `draft`; `MIND_SEND_ENABLED` is unset
- [ ] One Direction written for a sender or topic you actually get mail from
- [ ] `mind preview <directionId>` shows what it would have caught — if it
      catches nothing, the `scope`/`matchPrompt` is wrong, not the model
- [ ] `mind coverage` returns twelve weeks (mostly empty — that is the baseline)

## 7. Daily rhythm for the week

1. Open the brief. Read `thoughts.disputed` first: those are the ones the tool
   is confident it _cannot_ answer, and they are where your judgement pays.
2. Review the Queue only if a Direction is at `draft`; discard what you would
   not have sent. Every discard is the learning-loop input.
3. Once a day: `mind coverage`. Note absorb rate **on explicit Directions** and
   `absorbedUnanswered`. Do not look at totals.
4. Weekly: `mind proposals`, accept what you agree with, and hand-edit the YAML —
   the DB row alone would be reverted by the next reload, by design.

## 8. When something looks wrong

| Symptom                               | First thing to check                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Nothing arrives from a source         | `mind doctor`; `/health` adapter list; adapter logs (`~/.data/kIiYOSJe/mind/mind.log`)                                       |
| Everything matches the catch-all      | `mind preview <directionId>` and the Direction's `scope`/`matchPrompt` (STATUS gap #12)                                      |
| A decision is inexplicable            | `mind explain <signalId>` — the `signal.processed` event carries intent, confidence, blocker, commitment, guards, and reason |
| A draft is bad but the match is right | The Direction's `standard`, not the model. Tighten it, then `mind preview`                                                   |
| The same promise reminds twice        | Should not happen — commitments supersede per thread. If it does, that thread had no `threadId`; check the adapter           |
| A send happened and should not have   | `mind pause` immediately, then read the `action.sent` event: it records which gates passed                                   |
