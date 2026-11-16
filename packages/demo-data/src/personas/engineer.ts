/**
 * Persona: Software Engineer.
 *
 * Proves: high volume absorbed with autonomy:send, routine CI noise surfaced
 * (not answered), one genuine production-outage escalation that bypasses
 * autonomy entirely via the escalateOn guard.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-26T09:00:00.000Z"); // 3-week window, compressed to a day's replay

export const engineerScenario: PersonaScenario = {
  id: "engineer",
  displayName: "Software Engineer",
  pitch:
    "A working engineer's week is dominated by answerable questions and routine CI noise. " +
    "mind absorbs the questions it can answer outright, files CI failures as Thoughts instead " +
    "of replying to a bot, and when a real outage page arrives — even with a draft already " +
    "written and high classifier confidence — the escalateOn guard still blocks the autonomous " +
    "send and routes it to the operator for approval.",
  directionFiles: [
    "demo/engineer/teammate-questions.yaml",
    "demo/engineer/ci-alerts.yaml",
    "demo/engineer/pr-pings.yaml",
    "demo/engineer/oncall.yaml",
  ],
  startAt: START,
  signals: [
    {
      atHour: 0,
      signal: {
        adapter: "demo-email", externalId: "eng-1", threadId: "t-build-flag",
        sender: "priya@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Quick one — what flag turns off the flaky integration suite in CI? Build's been timing out.",
      },
      classification: {
        directionId: "demo/engineer/teammate-questions", confidence: 0.92,
        intent: "ask for a CI flag name", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "The flag is --skip-flaky (set SKIP_FLAKY=1 in the CI env). It's documented in ci/README.md under \"known-flaky suites\".",
      narrative: "Answerable factual question — absorbed and auto-sent, autonomy: send.",
    },
    {
      atHour: 1,
      signal: {
        adapter: "demo-email", externalId: "eng-2", threadId: null,
        sender: "ci-bot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Build #4821 failed on main: 2 tests failed in packages/billing (test timeout).",
      },
      classification: {
        directionId: "demo/engineer/ci-alerts", confidence: 0.95,
        intent: "CI failure notification", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "posture is surface — not meant to be answered",
      },
      draftBody: null,
      narrative: "Routine CI noise. Posture=surface means it becomes a Thought, not a reply — the bot is never messaged back.",
    },
    {
      atHour: 1.5,
      signal: {
        adapter: "demo-email", externalId: "eng-3", threadId: null,
        sender: "ci-bot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Build #4822 failed on main: 2 tests failed in packages/billing (test timeout).",
      },
      classification: {
        directionId: "demo/engineer/ci-alerts", confidence: 0.95,
        intent: "CI failure notification (repeat)", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "posture is surface",
      },
      draftBody: null,
      narrative: "Second consecutive failure on the same suite — still filed as evidence, not escalated on its own.",
    },
    {
      atHour: 4,
      signal: {
        adapter: "demo-email", externalId: "eng-4", threadId: "t-pr-204",
        sender: "jordan@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Can you review PR #204 when you get a chance? It's the rate-limit middleware refactor.",
      },
      classification: {
        directionId: "demo/engineer/pr-pings", confidence: 0.88,
        intent: "request a code review", signalKind: "task", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Got it — I'll review PR #204 (rate-limit middleware refactor) this afternoon.",
      narrative: "PR review request — acknowledged and scheduled, never approves on the engineer's behalf.",
    },
    {
      atHour: 7,
      signal: {
        adapter: "demo-email", externalId: "eng-5", threadId: "t-db-index",
        sender: "sam@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Where's the migration that added the index on orders.customer_id? Can't find it.",
      },
      classification: {
        directionId: "demo/engineer/teammate-questions", confidence: 0.9,
        intent: "ask for file location", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "It's migrations/0047_add_customer_id_index.sql, added in PR #178.",
      narrative: "Another answerable factual question, same pattern as the first.",
    },
    {
      atHour: 8,
      signal: {
        adapter: "demo-email", externalId: "eng-6", threadId: null,
        sender: "oncall-pager@demo.corp", recipients: ["me@demo.corp"], kind: "alert",
        body: "PAGE: production outage — checkout service returning 500s for all requests since 08:52 UTC. Customer impact confirmed.",
        urgencyHint: 1,
      },
      classification: {
        directionId: "demo/engineer/oncall", confidence: 0.3,
        intent: "production outage alert", signalKind: "task", urgency: "high",
        commitment: null, escalateBy: "2026-10-26T18:30:00.000Z", sensitiveTopics: ["production outage"],
        answerable: false, answerBlocker: "production outage — human must respond",
      },
      draftBody: null,
      narrative: "Confidence (0.3) is below oncall-pages' own confidenceMin (0.6), so this escalates on the confidence floor alone before the guard is even evaluated — belt and suspenders. See eng-6b for the case where confidence is high and only the escalateOn guard stops the send.",
    },
    {
      atHour: 8.5,
      signal: {
        adapter: "demo-email", externalId: "eng-6b", threadId: null,
        sender: "oncall-pager@demo.corp", recipients: ["me@demo.corp"], kind: "alert",
        body: "Follow-up: production outage confirmed resolved. Customer impact window: 08:52-09:40 UTC. Postmortem to follow.",
        urgencyHint: 1,
      },
      classification: {
        directionId: "demo/engineer/oncall", confidence: 0.82,
        intent: "outage resolution notice", signalKind: "information", urgency: "high",
        commitment: null, escalateBy: "2026-10-26T18:30:00.000Z", sensitiveTopics: ["production outage"],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Acknowledged — outage resolution noted, awaiting postmortem.",
      narrative: "High confidence (0.82), well above oncall-pages' 0.65 threshold — the direction drafts an acknowledgement exactly as autonomy:send would normally auto-send it. But 'production outage' still appears in the body, so the escalateOn guard trips: the draft exists (shouldDraft stays true) but shouldSend is forced false, and the action waits in Review rather than going out automatically. This is the case that isolates the guard from the confidence floor.",
    },
    {
      atHour: 9,
      signal: {
        adapter: "demo-email", externalId: "eng-7", threadId: null,
        sender: "ci-bot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Build #4830 passed on main after fix.",
      },
      classification: {
        directionId: "demo/engineer/ci-alerts", confidence: 0.95,
        intent: "CI success notification", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "posture is surface",
      },
      draftBody: null,
      narrative: "Resolution evidence — closes the loop on the earlier build failures in the Thought history.",
    },
    {
      atHour: 30,
      signal: {
        adapter: "demo-email", externalId: "eng-8", threadId: "t-pr-204",
        sender: "jordan@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Any update on PR #204?",
      },
      classification: {
        directionId: "demo/engineer/pr-pings", confidence: 0.85,
        intent: "follow-up on review status", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Reviewed — left two comments on the error-handling path, otherwise looks good. Should be ready to merge once those are addressed.",
      narrative: "Same thread, later in the compressed timeline — demonstrates thread continuity in the signal/thought ratio.",
    },
    {
      atHour: 55,
      signal: {
        adapter: "demo-email", externalId: "eng-9", threadId: null,
        sender: "casey@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "What's our policy on pinning transitive dependency versions?",
      },
      classification: {
        directionId: "demo/engineer/teammate-questions", confidence: 0.55,
        intent: "ask about team policy", signalKind: "question", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "not a factual lookup — a policy judgement call",
      },
      draftBody: null,
      narrative: "Confidence 0.55 is below the direction's 0.7 threshold — escalated to a Thought rather than answered, because this needs a human's judgement, not a fact lookup.",
    },
  ],
};
