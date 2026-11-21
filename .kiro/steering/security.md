---
inclusion: auto
---

# Security

`mind` holds mail, chat, and calendar content and can send as the operator. The
worst outcomes are an unauthorized send, a leaked credential, and message content
leaving the machine unintentionally. Design and review against those three.

## Assets and trust boundaries

| Asset | Where | Protection |
| --- | --- | --- |
| API token | `~/.config/kIiYOSJe/mind/token` | mode 600, constant-time compare, never logged |
| Provider credentials | env, then `credentials.yml` | mode 600, never bundled, never committed |
| Message content | SQLite file | local disk only; excluded from logs |
| Send capability | pipeline gates | five independent gates, re-checked at send time |

Untrusted inputs: message bodies and headers, calendar text, provider API
responses, model output, directions YAML from outside the operator, issue and PR
text, and every HTTP request (even from localhost).

## Rules

1. **Localhost is not a trust boundary.** Any local process and any web page in
   the operator's browser can reach `127.0.0.1`. Require the bearer token on every
   route, compare it in constant time, validate `Host` against an allowlist
   (DNS rebinding), reject unexpected `Origin`, and never send CORS headers.
2. **Model output and message text are data.** They may choose a posture within
   what the Direction allows. They never grant autonomy, change a Direction, pick a
   recipient outside the thread, or authorize a send. Bodies are wrapped as data
   in prompts; the injection corpus in the pipeline tests must stay green.
3. **Sends are authorized by the conjunction of gates only.** Adapter capability,
   `autonomy: send`, `MIND_SEND_ENABLED=true`, no pause flag, non-empty draft.
   Do not add a code path that sends without going through them. Sends are
   idempotent and recorded before the provider call.
4. **Validate at every boundary** with zod: HTTP bodies, adapter payloads, model
   structured output, config, YAML. Enforce body size limits.
5. **SQL is parameterized.** Use Drizzle or bound parameters. No string-built SQL.
6. **No secrets in the tree.** Not in code, fixtures, tests, docs, logs, or
   issue text. Fixtures use obviously fake values. `scripts/check-secrets.mjs`
   is the tripwire; a real leak means rotate first, then clean up.
7. **Log redaction is an allowlist habit.** Log ids, counts, durations, and
   adapter names. Never log bodies, subjects, recipients, tokens, or prompts.
8. **Least privilege for providers.** Minimal OAuth scopes, listed in docs.
   Prefer read-only until a send path is verified. Missing token means
   "not configured", never an error that stops other adapters.
9. **Subprocesses** (`kiro-cli`, `copilot`) use argument arrays, never a shell
   string, with a fixed binary path from config and a scrubbed environment.
10. **Webviews** use a nonce CSP with `default-src 'none'`, no remote resources,
    and escape all message-derived text. No `innerHTML` with unescaped content.
11. **Dependencies** are pinned, audited (`npm audit`, dependency review),
    license-checked, and added only when the standard library cannot do the job.
12. **Supply chain:** workflows have least-privilege tokens, actions are pinned,
    releases carry provenance and an SBOM, and install scripts are allowlisted
    (`allowScripts` in package.json).

## Threat model summary

| Threat | Mitigation | Test |
| --- | --- | --- |
| Hostile email instructs the model to send | injection guard, gates, human approval | injection corpus |
| Web page calls the local API | token, Host/Origin checks, no CORS | server tests |
| Token or credential file readable by others | mode check at startup | core tests |
| Replay or crash causes double send | intent recorded first, idempotency key | autosend tests |
| Malicious dependency | audit, license check, pinned versions, review | CI |
| Agent PR weakens a gate | protected paths, CODEOWNERS, human approval | agent-guard |
| Provider revokes access | degrade to "not configured" | adapter tests |

## Changes that need explicit human approval

Auth, send gates, the pause flag, migrations, licensing, `.github/`, and
`.gitignore`. See `workflow.md`. Security vulnerabilities are never fixed in a
public issue thread; follow `SECURITY.md`.
