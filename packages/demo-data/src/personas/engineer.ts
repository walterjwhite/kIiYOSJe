/**
 * Persona: Software Engineer.
 *
 * Fake signals, real decisions. Historical signals are replayed and then
 * given a simulated operator reaction so the system looks lived-in. Live
 * signals are replayed and left exactly as the model decided — they appear
 * in Review for the operator to act on.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-26T09:00:00.000Z");

export const engineerScenario: PersonaScenario = {
  id: "engineer",
  displayName: "Software Engineer",
  pitch:
    "A working engineer's week is dominated by questions a model can answer " +
    "outright, routine CI noise, and the occasional page that genuinely " +
    "needs a human. Nothing about which bucket a message falls into is " +
    "decided in advance — the classifier and drafter are real model calls " +
    "against whatever direction matched.",
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
      era: "historical",
      intent: "answerable factual question — exercises teammate-questions",
      signal: {
        adapter: "demo-email",
        externalId: "eng-1",
        threadId: "t-build-flag",
        sender: "priya@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Quick one — what flag turns off the flaky integration suite in CI? Build's been timing out.",
      },
    },
    {
      atHour: 1,
      era: "historical",
      intent: "routine CI noise — exercises ci-alerts (posture: surface)",
      signal: {
        adapter: "demo-email",
        externalId: "eng-2",
        threadId: null,
        sender: "ci-bot@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "notification",
        body: "Build #4821 failed on main: 2 tests failed in packages/billing (test timeout).",
      },
    },
    {
      atHour: 1.5,
      era: "historical",
      intent: "second consecutive CI failure, same suite",
      signal: {
        adapter: "demo-email",
        externalId: "eng-3",
        threadId: null,
        sender: "ci-bot@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "notification",
        body: "Build #4822 failed on main: 2 tests failed in packages/billing (test timeout).",
      },
    },
    {
      atHour: 4,
      era: "historical",
      intent: "PR review request — exercises pr-pings",
      signal: {
        adapter: "demo-email",
        externalId: "eng-4",
        threadId: "t-pr-204",
        sender: "jordan@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Can you review PR #204 when you get a chance? It's the rate-limit middleware refactor.",
      },
    },
    {
      atHour: 7,
      era: "historical",
      intent: "second answerable factual question",
      signal: {
        adapter: "demo-email",
        externalId: "eng-5",
        threadId: "t-db-index",
        sender: "sam@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Where's the migration that added the index on orders.customer_id? Can't find it.",
      },
    },
    {
      atHour: 8,
      era: "historical",
      intent: "genuine outage page — exercises oncall + escalateOn guard",
      signal: {
        adapter: "demo-email",
        externalId: "eng-6",
        threadId: null,
        sender: "oncall-pager@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "alert",
        body: "PAGE: production outage — checkout service returning 500s for all requests since 08:52 UTC. Customer impact confirmed.",
        urgencyHint: 1,
      },
    },
    {
      atHour: 8.5,
      era: "historical",
      intent: "outage resolution follow-up, still mentions 'production outage'",
      signal: {
        adapter: "demo-email",
        externalId: "eng-6b",
        threadId: null,
        sender: "oncall-pager@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "alert",
        body: "Follow-up: production outage confirmed resolved. Customer impact window: 08:52-09:40 UTC. Postmortem to follow.",
        urgencyHint: 1,
      },
    },
    {
      atHour: 9,
      era: "historical",
      intent: "CI recovery notice",
      signal: {
        adapter: "demo-email",
        externalId: "eng-7",
        threadId: null,
        sender: "ci-bot@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "notification",
        body: "Build #4830 passed on main after fix.",
      },
    },
    // ── live era — left unresolved for the operator to act on ──────────────
    {
      atHour: 0,
      era: "live",
      intent: "PR follow-up in an existing thread",
      signal: {
        adapter: "demo-email",
        externalId: "eng-8",
        threadId: "t-pr-204",
        sender: "jordan@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Any update on PR #204?",
      },
    },
    {
      atHour: 0,
      era: "live",
      intent:
        "ambiguous policy question — likely low confidence, a judgement call rather than a lookup",
      signal: {
        adapter: "demo-email",
        externalId: "eng-9",
        threadId: null,
        sender: "casey@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "What's our policy on pinning transitive dependency versions?",
      },
    },
    {
      atHour: 0,
      era: "live",
      intent: "new teammate question, nothing special expected",
      signal: {
        adapter: "demo-email",
        externalId: "eng-10",
        threadId: null,
        sender: "priya@demo.corp",
        recipients: ["me@demo.corp"],
        kind: "message",
        body: "Is the staging environment back up? I need to run the migration test before end of day.",
      },
    },
  ],
};
