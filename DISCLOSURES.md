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

## External programs and downloaded files

| Item | How it is used | Source | License |
| --- | --- | --- | --- |
| Piper text to speech | Run by the operator-installed `piper` command as a separate process to render the spoken summary. No Piper code is in this repository. Optional. | <https://github.com/OHF-Voices/piper1-gpl> | GPL-3.0 (program); not distributed with this project |
| Piper voice files | Downloaded once, only when the operator names a voice and leaves "Download voices" on, from the public `rhasspy/piper-voices` repository. | <https://huggingface.co/rhasspy/piper-voices> | Per voice; see each voice's model card |

The download is the only network use the audio feature adds. It is documented
in README "Audio summary (Piper)" and can be turned off in Settings.

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
