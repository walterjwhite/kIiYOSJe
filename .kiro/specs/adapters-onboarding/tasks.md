# Tasks — adapters and onboarding

- [x] 1. Gmail, Outlook (Graph), Calendar, and Matrix adapters implemented (unverified against live accounts)
- [x] 2. Missing credentials degrade to "not configured"
- [ ] 3. Contract test run over every adapter, including 401, 429, 5xx, revoked token
- [ ] 4. `/health` reports `not configured | observe | ok | failing` with last success time
- [ ] 5. Per-adapter onboarding doc: OAuth client setup, exact scopes, verify, revoke
- [ ] 6. Backoff with jitter and one operator message per window on failure
- [ ] 7. Live-account verification per adapter, in observe first (issue: "Verify each adapter against a live account")
- [ ] 8. Scopes confirmed against current provider docs and listed in README
- [ ] 9. Request send scopes only after verification; document the upgrade step
