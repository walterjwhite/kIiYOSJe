# Requirements — adapters and onboarding

## Introduction

Adapters connect Gmail, Outlook (Graph), Google Messages (via a separately
installed Matrix bridge), and Calendar. They must follow the third-party API
rules in `.kiro/steering/licensing.md`: documented, authorized, own credentials,
least scope, revocable.

## Requirement 1 — Contract

1. Every adapter SHALL implement `start`, `stop`, and optionally `send`, and
   declare its capabilities.
2. WHEN credentials are missing or invalid THEN the adapter SHALL log
   "not configured" once, return from `start`, and SHALL NOT affect other adapters.
3. Adapters SHALL NOT make decisions. They map provider data to signals and
   execute sends the pipeline authorized.

## Requirement 2 — Authorized access only

1. Each adapter SHALL use the provider's documented API with the operator's own
   OAuth client and token. No credentials are bundled or shared.
2. Requested scopes SHALL be the minimum for the feature and SHALL be listed in
   the adapter's docs.
3. The Google Messages adapter SHALL speak Matrix HTTP to the operator's own
   `mautrix-gmessages` and SHALL NOT contain bridge code or constants.
4. No adapter SHALL drive a consumer web client with scraped tokens.

## Requirement 3 — Onboarding

1. WHEN an operator adds a source THEN it SHALL start in `observe`.
2. Docs SHALL give, per adapter: how to create the OAuth client, the exact scopes,
   where credentials go, how to verify it works, and how to revoke access at the
   provider.
3. `/health` SHALL report each adapter as `not configured`, `observe`, `ok`, or
   `failing` with the last success time.
4. A helper script (`scripts/google-refresh-token.sh`) MAY obtain a refresh token
   and SHALL NOT print it to shared logs or store it anywhere but the operator's
   credentials file.

## Requirement 4 — Resilience

1. Token refresh failure SHALL move the adapter to `failing`, back off, and
   surface one operator-visible message per backoff window.
2. The adapter SHALL respect provider rate limits and `Retry-After`.
3. A replayed window after restart SHALL NOT produce duplicate signals
   (`adapter:externalId`).
4. Revoking access at the provider SHALL end ingest and return the adapter to
   `not configured` or `failing` without crashing the server.

## Requirement 5 — Verification before trust

1. An adapter SHALL be described as verified only after a recorded run against a
   live account: a day of traffic, no duplicates after restart, scopes match docs.
2. Docs and status SHALL say "implemented, unverified" until then.
3. Project docs SHALL NOT claim provider verification, certification, or partnership.
