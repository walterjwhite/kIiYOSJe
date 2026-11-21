# Disclosures

This file must be complete before submission. Entries marked TODO need the
author's knowledge; do not guess.

## Official APIs used

Only official, documented, user-authorized APIs, each with the operator's own credentials.

| Integration | API | Scopes | Docs |
| --- | --- | --- | --- |
| Gmail | Gmail API | TODO: confirm exact scopes in use | TODO |
| Outlook | Microsoft Graph | TODO | TODO |
| Calendar | Google Calendar API or an ICS URL the operator provides | TODO | TODO |
| Google Messages | Matrix client API of the operator's own `mautrix-gmessages` bridge | bridge access token | TODO |
| Models | the operator's configured provider (default: local Ollama) | n/a | TODO |

The project does not claim provider verification, certification, or partnership.
It does not support Teams.

## Pre-existing code

TODO: list any code, tooling, or content that existed before the submission
window, with file paths and origin. If none, write "None."

## AI-generated code

TODO: state which parts were written with AI assistance (tool and model), with
file paths or directories. Specs, steering, and hooks under `.kiro/` and most of
the source were produced in Kiro sessions; confirm and list precisely.

## Borrowed snippets

TODO: list any code or text copied from another project, with path, source URL,
and license. If none, write "None."

## Third-party dependencies

See `package-lock.json`. `npm run license:check` verifies the license set;
`npm sbom` produces a bill of materials for each release.

## Authorship

TODO: list contributors. State any contributor honestly; do not claim sole
ownership if it is not accurate.
