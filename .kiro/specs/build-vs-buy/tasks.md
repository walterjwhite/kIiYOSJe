# Tasks — use a public library where one fits

- [x] 1. Injection scan: `@stackone/defender` Tier 1 (`injection-detection`)
- [x] 2. Word matching: `stemmer` and `Intl.Segmenter` (`text-match.ts`, `match.ts`, `sensitive.ts`)
- [x] 3. Model calls: timeout, retry with backoff, circuit breaker, concurrency cap with `cockatiel`; settings in `resilience.json`
- [ ] 3a. Hold a signal and retry it later when the provider is down (`ai-quality.md`: defer, record why, retry with backoff). Today a failed call escalates the signal with confidence 0, which is safe but is not a retry.
- [ ] 3b. Show the circuit state (`closed`, `open`) in `/health`
- [x] 4. Quote and signature stripping: `email-reply-parser` chosen on 15 synthetic cases (13 against 6 and 9)
- [ ] 4a. Run the same comparison on a week of real mail shapes (redacted) before trusting the 13 of 15; the cases are synthetic
- [ ] 4b. A forwarded message and a legal disclaimer are still kept; decide whether either should be stripped
- [x] 5. Deadline grounding with `chrono-node` against `receivedAt`
- [ ] 5a. Add a deadline case to the evaluation set that fails when the grounding is removed
- [x] 6. Address parsing with `email-addresses` in the Gmail mapper (Outlook needs none)
- [x] 7. iCalendar with `node-ical`: TZID, RRULE, EXDATE, hostile rules
- [ ] 7a. Run it against a real ICS feed from your calendar
- [x] 8. ACP: the SDK was evaluated and not adopted yet; the client now refuses requests from the agent
- [ ] 8a. Re-evaluate `@agentclientprotocol/sdk` against the real Kiro and Copilot agents
- [x] 9. HTML email: remote images are blocked by the inherited CSP (by reading)
- [ ] 9a. Confirm it in a running VS Code with a message that has a remote image
- [ ] 10. Re-run this audit before each release; add rows for new hand-written code
