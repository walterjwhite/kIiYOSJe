# Tasks — safety and send gating

Source of truth for open work is GitHub Issues (`safety-gate` label). Items below
are checked only when shipped and tested.

- [x] 1. Gates and pause exist and are tested with a fake adapter (STATUS.md P4)
- [ ] 2. One-gate-off matrix test (issue: "Prove each send gate blocks a send on its own")
- [ ] 3. Gates re-checked at send time with a test that flips a gate in between
- [ ] 4. `send_intent` table, idempotency key, and crash-recovery test (issue: "Make sends idempotent and recoverable")
- [ ] 5. Injection corpus of at least 20 fixtures (issue: "Add a prompt-injection regression corpus")
- [ ] 6. Model failure defers, never absorbs or sends (see model-bounds issue)
- [ ] 7. Demo data cannot reach a real adapter (issue: "Demo data can never reach a real adapter")
- [ ] 8. Audit rows carry gate results, model id, prompt version
- [ ] 9. Approve-after-edit requires fresh approval
- [ ] 10. No real adapter can send yet; verify one end to end against a live account in observe, then send (blocked on live-account verification)
