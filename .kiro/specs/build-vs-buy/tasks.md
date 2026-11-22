# Tasks — use a public library where one fits

- [x] 1. Injection scan: `@stackone/defender` Tier 1 (`injection-detection`)
- [x] 2. Word matching: `stemmer` and `Intl.Segmenter` (`text-match.ts`, `match.ts`, `sensitive.ts`)
- [ ] 3. Model calls: timeout, retry with backoff, circuit breaker, concurrency cap with `cockatiel`; defer a signal when the provider is down (`performance.md`)
- [ ] 4. Quote and signature stripping: compare `email-reply-parser` and `planer` on synthetic fixtures; adopt the better
- [ ] 5. Deadline grounding with `chrono-node` against `receivedAt`
- [ ] 6. Address parsing with `email-addresses` in the Gmail and Outlook mappers
- [ ] 7. iCalendar: look at a real ICS feed, then decide on `node-ical`
- [ ] 8. ACP: compare `@agentclientprotocol/sdk` with `acp.ts` and `json-rpc.ts`
- [ ] 9. HTML email: check whether remote images load inside the sandboxed iframe
- [ ] 10. Re-run this audit before each release; add rows for new hand-written code
