# Security policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private reporting:
<https://github.com/walterjwhite/kIiYOSJe/security/advisories/new>

Include what you found, how to reproduce it, and the version or commit. Do not
include real credentials or message content.

Expect an acknowledgement within 7 days. This is a single-maintainer project, so
fix times depend on severity; the maintainer will say what to expect in the reply.

## Supported versions

Only the latest release is supported while the project is `0.x`.

## What is in scope

- Unauthorized access to the local API, including through a browser
- Any path that sends a message without every send gate passing
- Prompt injection that changes a decision, a recipient, or autonomy
- Credential or message-content exposure in files, logs, or artifacts
- Supply-chain issues in the build, release, or dependency set

## Out of scope

- Attacks that require an attacker who already controls the operator's account
  or machine as the same OS user
- Findings about third-party providers or the `mautrix-gmessages` bridge
- Model quality issues that do not cross a safety boundary (file a normal issue)

## Design notes for researchers

The server binds to `127.0.0.1`, requires a bearer token on every route, and
stores config and credentials with mode 600. See `.kiro/steering/security.md` for
the threat model.

## Safe harbor

Good-faith research within this scope, on your own instance with your own data,
will not be pursued.
