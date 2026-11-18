---
inclusion: always
---

# Licensing and third-party terms

Two separate obligations, both a submission requirement: the code we ship must
be distributable under BSD-3-Clause, and every external service we talk to must
be one we are authorized to use.

## Dependency licenses

Run `npm run license:check` after any dependency change. It reads the lockfile
offline and fails on the deny list below.

| Verdict | Licenses | Rule |
| --- | --- | --- |
| Allowed | MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0, Python-2.0, BlueOak-1.0.0 | Keep the copyright notice; add a NOTICE entry if Apache-2.0 requires it. |
| Review | MPL-2.0, EPL-2.0, CDDL, LGPL-2.1/3.0, Artistic-2.0 | Acceptable only while the package is unmodified and, ideally, dev-only. Never patch a file in these packages. |
| Denied | GPL-2.0/3.0, AGPL-3.0, SSPL, BUSL-1.1, Commons Clause, CC-BY-NC, CC-BY-ND, `UNLICENSED`, "no license" | Do not add. Find an alternative with a permissive license. |

- A dev-only tool is not distributed, so its license does not reach the VSIX or
  the server artifact — but it still must not be vendored into `src/`.
- Apache-2.0 requires preserving `LICENSE`/`NOTICE` text and stating changes.
  This repo ships no modified Apache-2.0 code; keep it that way.
- Never copy code from a project without reading its license first. Copying a
  function from an AGPL project makes the file AGPL.

## Bridges and copied protocol code

An AGPL or source-available project may be *talked to* over its public interface
without its license reaching us; it may not be *vendored*. `mautrix-gmessages` is
the concrete case here: the adapter speaks Matrix HTTP to a separately installed
bridge and contains none of its code. Keep that boundary — no copied payload
shapes, no pasted constants, no `git submodule` of the bridge.

## Third-party APIs

Before any new integration, all five must be true:

1. **Documented** — there is public developer documentation for the endpoint.
2. **Authorized** — the provider's terms permit this use, and the API is the
   intended access path, not a consumer web client driven with scraped tokens.
3. **Own credentials** — the operator supplies their own OAuth client and token;
   nothing is bundled, and nothing is shared between installs.
4. **Least scope** — request only the scopes the feature needs, and say which
   scopes in the docs.
5. **Revocable** — the operator can revoke access at the provider, and the app
   degrades to "not configured" when a token is missing.

A sixth, softer test: would this survive a provider email asking what you are
doing? If the answer is uncomfortable, it is the wrong transport.

This is why the unofficial Microsoft Teams web-client adapter was deleted. Do not
reintroduce it, and do not describe the project as supporting Teams.

## Required disclosures

- Pre-existing code, generated code, and borrowed snippets are disclosed in the
  submission write-up, with the file paths.
- The submission states that only official, user-authorized APIs are used, and
  names them.
- The submission does not claim provider verification, certification, or
  partnership that does not exist.

## Our own license

BSD-3-Clause everywhere: root `LICENSE`, `"license"` in every `package.json`,
`extension/LICENSE` shipped as `LICENSE.txt` in the VSIX, and the license visible
in the GitHub About panel. Changing the license is a submission-level decision,
not a code change.
