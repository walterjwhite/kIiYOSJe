# Design — adapters and onboarding

## Layout

`packages/adapters/src/<source>/` holds `client.ts` (network), `adapter.ts`
(contract), and pure mapping modules with unit tests. A registry
(`adapter-registry.ts`) owns lifecycle and `/health` state.

## State machine per adapter

`not configured` → `observe` → `ok`, with `failing` reachable from `observe` and
`ok`. Transitions are logged once. `failing` retries with exponential backoff and
jitter and returns to the previous state on success.

## Credentials

Environment first, then `credentials.yml` (mode 600). The adapter asks core for
its keys by name and treats absence as `not configured`. OAuth refresh happens in
`client.ts`; refreshed access tokens stay in memory; the refresh token never
leaves the credentials file.

## Scopes (document and keep minimal)

| Adapter         | Read                                     | Send                                                      | Notes                                           |
| --------------- | ---------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Gmail           | `gmail.readonly`                         | `gmail.send` or `gmail.compose` only when send is enabled | request send scope only after live verification |
| Outlook (Graph) | `Mail.Read`                              | `Mail.Send` or draft-only `Mail.ReadWrite`                | draft-then-send flow                            |
| Calendar        | `calendar.readonly`                      | `calendar.events` only if write is enabled                | ICS URL option needs no OAuth                   |
| Google Messages | Matrix access token on operator's bridge | via bridge                                                | operator installs and runs the bridge           |

Confirm against current provider docs when implementing; scopes change.

## Testing

- Contract test run against every adapter with a fake HTTP layer.
- Mapping tests with recorded, anonymized provider payloads.
- Failure tests: 401, 429 with `Retry-After`, 5xx, network down, revoked token.
- Replay test for dedupe.

## Not supported

Teams. The unofficial web-client adapter was removed because it violated the
authorized-API rule. Do not reintroduce it.
