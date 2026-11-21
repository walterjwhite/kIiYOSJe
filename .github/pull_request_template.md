## Summary

<!-- What changed and why, in two or three sentences. -->

Closes #

## How it was verified

- [ ] `npm run lint`
- [ ] `npm test` (new or changed behavior has a test that fails without the change)
- [ ] `npm run license:check` (required if any manifest or lockfile changed)
- [ ] `node scripts/check-secrets.mjs`

## Risk checklist

- [ ] Does not weaken a send gate, the pause flag, or authentication
- [ ] No new network egress; model-provider calls stay the only one
- [ ] No message bodies or credentials in logs, fixtures, or docs
- [ ] No applied migration edited (a new migration was added instead)
- [ ] Specs, steering, and docs updated where behavior changed
- [ ] `.kiro/specs/**/tasks.md` updated

## AI assistance

- [ ] This PR was written by an AI agent (add the `ai-generated` label)
- Agent and model:
- Anything the reviewer should double-check:
