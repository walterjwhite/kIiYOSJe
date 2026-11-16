/**
 * Fake data for the mind VS Code extension mockup.
 * Shapes mirror the real API responses (see packages/server/src/routes/*.ts)
 * closely enough that swapping this file for real fetch() calls later is
 * mechanical, not a rewrite.
 */

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const hoursFromNow = (h) => new Date(now + h * 3600_000).toISOString();

window.MOCK_STATE = {
  serverUrl: "http://127.0.0.1:8787",
  aiProvider: "ollama",
  aiModel: "qwen2.5:3b-instruct",
  paused: false,

  directions: [
    { id: "demo/pm/status-requests", name: "status-requests", posture: "absorb", autonomy: "draft", enabled: true },
    { id: "demo/pm/scheduling", name: "scheduling", posture: "absorb", autonomy: "send", enabled: true },
    { id: "demo/pm/vendor-noise", name: "vendor-noise", posture: "absorb", autonomy: "draft", enabled: false },
    { id: "demo/devsecops/security-alerts", name: "security-alerts", posture: "escalate", autonomy: "observe", enabled: true },
    { id: "demo/devsecops/dependabot", name: "dependabot", posture: "absorb", autonomy: "draft", enabled: true },
  ],

  thoughts: [
    {
      id: "t-1",
      title: "possible security incident — security-team@demo.corp",
      body: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC. Investigating. Do not deploy until cleared.",
      state: "active",
      directionId: "demo/devsecops/security-alerts",
      nextAction: null,
      reviewAt: null,
      escalateBy: hoursAgo(2),
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(1),
    },
    {
      id: "t-2",
      title: "ambiguous status request, no project named",
      body: "What's the status?",
      state: "seedling",
      directionId: "demo/pm/status-requests",
      nextAction: "Ask which project/workstream this refers to",
      reviewAt: null,
      escalateBy: hoursFromNow(20),
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
    },
    {
      id: "t-3",
      title: "ask about team policy on dependency pinning",
      body: "What's our policy on pinning transitive dependency versions?",
      state: "seedling",
      directionId: null,
      nextAction: null,
      reviewAt: null,
      escalateBy: null,
      createdAt: hoursAgo(8),
      updatedAt: hoursAgo(8),
    },
    {
      id: "t-4",
      title: "Q4 migration status committed by Friday EOD",
      body: "Need a status update on the Q4 migration for the steering committee by Friday EOD.",
      state: "parked",
      directionId: "demo/pm/status-requests",
      nextAction: "Status update due Friday EOD",
      reviewAt: hoursFromNow(48),
      escalateBy: hoursFromNow(70),
      createdAt: hoursAgo(20),
      updatedAt: hoursAgo(6),
    },
    {
      id: "t-5",
      title: "CI failure notifications — ci-bot@demo.corp",
      body: "Build #4821 failed on main: 2 tests failed in packages/billing (test timeout).",
      state: "closed",
      directionId: "demo/devsecops/dependabot",
      nextAction: null,
      reviewAt: null,
      escalateBy: null,
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(28),
    },
  ],

  actions: [
    {
      id: "a-1",
      kind: "reply",
      status: "proposed",
      adapter: "demo-email",
      directionId: "demo/pm/status-requests",
      signalFrom: "director@demo.corp",
      createdAt: hoursAgo(0.2),
      payload: {
        to: ["director@demo.corp"],
        threadId: "t-release-status",
        replyToExternalId: "pm-8",
        body: "The latest release timeline for the next sprint is currently projected for the 14th, pending QA sign-off. I'll confirm with the steering committee once QA finishes regression testing.",
      },
    },
    {
      id: "a-2",
      kind: "reply",
      status: "proposed",
      adapter: "demo-email",
      directionId: "demo/pm/vendor-noise",
      signalFrom: "vendor-rep4@fourthco.com",
      createdAt: hoursAgo(0.3),
      payload: {
        to: ["vendor-rep4@fourthco.com"],
        threadId: null,
        replyToExternalId: "pm-9",
        body: "Thank you for reaching out. Your request to discuss payment terms has been forwarded for review.",
      },
    },
    {
      id: "a-3",
      kind: "reply",
      status: "proposed",
      adapter: "demo-email",
      directionId: "demo/devsecops/dependabot",
      signalFrom: "dependabot@demo.corp",
      createdAt: hoursAgo(0.5),
      payload: {
        to: ["dependabot@demo.corp"],
        threadId: null,
        replyToExternalId: "sec-8",
        body: "Acknowledged. The minimist update (prototype pollution fix) will be reviewed in the next maintenance window.",
      },
    },
  ],

  proposals: [
    {
      eventId: "p-1",
      at: hoursAgo(1),
      status: "pending",
      proposal: {
        kind: "narrow",
        directionId: "demo/pm/vendor-noise",
        field: "confidenceMin",
        currentValue: 0.5,
        proposedValue: 0.55,
        rationale: "Override rate 100% over 4 actions exceeds 20% threshold.",
        evidence: { total: 4, discarded: 4, sent: 0, overrideRate: 1 },
      },
    },
    {
      eventId: "p-2",
      at: hoursAgo(3),
      status: "pending",
      proposal: {
        kind: "narrow",
        directionId: "demo/devsecops/dependabot",
        field: "confidenceMin",
        currentValue: 0.65,
        proposedValue: 0.7,
        rationale: "Override rate 60% over 5 actions exceeds 20% threshold.",
        evidence: { total: 5, discarded: 3, sent: 2, overrideRate: 0.6 },
      },
    },
  ],

  metrics: {
    window: "7d",
    signals: 30,
    thoughts: 5,
    ratio: 6.0,
    absorbed: 21,
    absorbRate: 0.7,
    overrideRate: 0.27,
    sendsWithoutRevert: 10,
  },
};
