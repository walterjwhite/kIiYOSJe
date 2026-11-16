/**
 * Fake data for the mind extension mockup — signal-centric redesign.
 *
 * Everything is a SIGNAL. A signal has a common envelope:
 *   id, channel, direction ("in"|"out"), from, to, timestamp, summary, status
 *
 * A signal that still needs a decision also carries `request`:
 *   { kind: "approve-send" | "external-review" | "acknowledge", urgencyScore,
 *     threadKey, escalateBy, context }
 *
 * `context` is intentionally open-ended. For an "external-review" signal it
 * is whatever the originating system (a Jira automation, a CI pipeline, a
 * monitoring tool) chose to report about its own work — this mockup renders
 * context.stages / context.notes / context.links generically, because a
 * different source might report something with no stages at all. The point
 * is: this UI does not know what Jira's bot did. It only knows what that
 * bot told it, via (in the real version) a callback endpoint exposed by the
 * external utility — see README.md.
 *
 * Signals with no `request` already happened — a calendar event, a chat
 * message with no action needed, an outbound reply that already sent. They
 * appear only in the Signals Log, never in the Work Queue.
 */

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const hoursFromNow = (h) => new Date(now + h * 3600_000).toISOString();

window.MOCK_STATE = {
  serverUrl: "http://127.0.0.1:8787",
  aiProvider: "ollama",
  aiModel: "qwen2.5:3b-instruct",
  paused: false,
  sortMode: "urgency", // "urgency" | "flow"
  selectedSignalId: null,
  activeView: "queue", // "queue" | "log"
  logFilter: { channel: "all", direction: "all" },

  directions: [
    { id: "demo/pm/status-requests", name: "status-requests", posture: "absorb", autonomy: "draft", enabled: true },
    { id: "demo/eng/pr-pipeline", name: "pr-pipeline", posture: "absorb", autonomy: "draft", enabled: true },
    { id: "demo/pm/vendor-noise", name: "vendor-noise", posture: "absorb", autonomy: "draft", enabled: false },
    { id: "demo/devsecops/security-alerts", name: "security-alerts", posture: "escalate", autonomy: "observe", enabled: true },
    { id: "demo/devsecops/dependabot", name: "dependabot", posture: "absorb", autonomy: "draft", enabled: true },
  ],

  proposals: [
    {
      eventId: "p-1",
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
      status: "pending",
      proposal: {
        kind: "widen",
        directionId: "demo/eng/pr-pipeline",
        field: "autonomy",
        currentValue: "draft",
        proposedValue: "send",
        rationale: "7 of the last 8 ticket reviews were approved without edits; confidence has been above 0.8 on all but 2.",
        evidence: { total: 8, discarded: 1, sent: 7, overrideRate: 0.125 },
      },
    },
  ],

  // ── Signals: the one object model, inbound and outbound, all channels ──
  signals: [
    {
      id: "s-1",
      channel: "email",
      direction: "in",
      from: "security-team@demo.corp",
      to: "me",
      timestamp: hoursAgo(0.1),
      summary: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC.",
      body: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC. Investigating. Do not deploy until cleared.",
      status: "open",
      threadKey: "incident-staging-db",
      directionId: "demo/devsecops/security-alerts",
      request: {
        kind: "acknowledge",
        urgencyScore: 100,
        escalateBy: hoursAgo(0),
        context: {
          reason: "escalateOn guard matched 'unauthorized access' — posture: escalate, no draft or send attempted.",
        },
      },
    },
    {
      id: "s-2",
      channel: "jira",
      direction: "in",
      from: "jira-automation",
      to: "me",
      timestamp: hoursAgo(2),
      summary: "TICKET-4821 — add rate-limit bypass for internal service accounts",
      body: "Implemented, unit + integration tests passing, adversarial review raised one concern about auth header spoofing on internal-only routes.",
      status: "open",
      threadKey: "TICKET-4821",
      directionId: "demo/eng/pr-pipeline",
      request: {
        kind: "external-review",
        urgencyScore: 62,
        escalateBy: hoursFromNow(4),
        context: {
          externalUrl: "https://jira.demo.corp/browse/TICKET-4821",
          confidence: 0.38,
          stages: [
            { name: "Implement", status: "done", detail: "4 files changed, +112/-18" },
            { name: "Unit tests", status: "done", detail: "38/38 passing" },
            { name: "Integration tests", status: "done", detail: "12/12 passing" },
            { name: "Adversarial review", status: "flagged", detail: "Possible auth header spoofing on internal routes" },
            { name: "Human review", status: "pending", detail: null },
            { name: "Open PR", status: "blocked", detail: "Waiting on human review" },
          ],
          notes:
            "The adversarial pass tried spoofing X-Internal-Service on three internal-only routes and got a 200 on one of them (/api/v2/billing/sync) instead of the expected 403. This may be an existing gap unrelated to this change, or introduced by the new bypass logic — recommend confirming before merging.",
          changedFiles: ["src/middleware/rate-limit.ts", "src/middleware/auth.ts", "test/rate-limit.test.ts", "test/auth.test.ts"],
        },
      },
    },
    {
      id: "s-3",
      channel: "jira",
      direction: "in",
      from: "jira-automation",
      to: "me",
      timestamp: hoursAgo(6),
      summary: "TICKET-4790 — fix flaky integration suite timeout",
      body: "Implemented, all tests passing, adversarial review found no issues.",
      status: "open",
      threadKey: "TICKET-4790",
      directionId: "demo/eng/pr-pipeline",
      request: {
        kind: "external-review",
        urgencyScore: 30,
        escalateBy: null,
        context: {
          externalUrl: "https://jira.demo.corp/browse/TICKET-4790",
          confidence: 0.88,
          stages: [
            { name: "Implement", status: "done", detail: "1 file changed, +6/-2" },
            { name: "Unit tests", status: "done", detail: "12/12 passing" },
            { name: "Integration tests", status: "done", detail: "41/41 passing, 3x re-run for flake confirmation" },
            { name: "Adversarial review", status: "clean", detail: "No issues found" },
            { name: "Human review", status: "pending", detail: null },
            { name: "Open PR", status: "blocked", detail: "Waiting on human review" },
          ],
          notes:
            "Confidence is high enough that this would normally proceed automatically, but pr-pipeline's autonomy is still set to draft — every PR waits for one approval until the direction is widened.",
          changedFiles: ["ci/jest.config.js"],
        },
      },
    },
    {
      id: "s-4",
      channel: "email",
      direction: "in",
      from: "director@demo.corp",
      to: "me",
      timestamp: hoursAgo(0.2),
      summary: "What's the latest on the release timeline for next sprint?",
      body: "What's the latest on the release timeline for next sprint? Steering committee is asking.",
      status: "open",
      threadKey: "t-release-status",
      directionId: "demo/pm/status-requests",
      request: {
        kind: "approve-send",
        urgencyScore: 45,
        escalateBy: hoursFromNow(18),
        context: {
          draft:
            "The latest release timeline for the next sprint is currently projected for the 14th, pending QA sign-off. I'll confirm with the steering committee once QA finishes regression testing.",
        },
      },
    },
    {
      id: "s-5",
      channel: "email",
      direction: "in",
      from: "vendor-rep4@fourthco.com",
      to: "me",
      timestamp: hoursAgo(0.4),
      summary: "We'd like to discuss a change in payment terms.",
      body: "We'd like to discuss a change in payment terms for the current contract — can we set up a call?",
      status: "open",
      threadKey: "vendor-fourthco",
      directionId: "demo/pm/vendor-noise",
      request: {
        kind: "approve-send",
        urgencyScore: 15,
        escalateBy: null,
        context: {
          draft: "Thank you for reaching out. Your request to discuss payment terms has been forwarded for review.",
        },
      },
    },
    {
      id: "s-6",
      channel: "email",
      direction: "in",
      from: "dependabot@demo.corp",
      to: "me",
      timestamp: hoursAgo(0.5),
      summary: "minimist 1.2.5 -> 1.2.8 available (moderate severity).",
      body: "minimist 1.2.5 -> 1.2.8 available (moderate severity, prototype pollution).",
      status: "open",
      threadKey: "dependabot-minimist",
      directionId: "demo/devsecops/dependabot",
      request: {
        kind: "approve-send",
        urgencyScore: 10,
        escalateBy: null,
        context: {
          draft: "Acknowledged. The minimist update (prototype pollution fix) will be reviewed in the next maintenance window.",
        },
      },
    },

    // ── Already-resolved / informational signals — Signals Log only ──────
    {
      id: "s-7",
      channel: "chat",
      direction: "in",
      from: "priya@demo.corp",
      to: "me",
      timestamp: hoursAgo(1),
      summary: "Does the new auth middleware apply to service-to-service calls?",
      body: "Does the new auth middleware apply to internal service-to-service calls, or only external requests?",
      status: "closed",
      threadKey: "chat-priya-auth",
      directionId: null,
      request: null,
      resolution: "answered directly — informational only, no action",
    },
    {
      id: "s-8",
      channel: "chat",
      direction: "out",
      from: "me",
      to: "jordan@demo.corp",
      timestamp: hoursAgo(1.9),
      summary: "Is PR #204's rate-limit refactor still planned to land before the freeze on Friday?",
      body: "Is PR #204's rate-limit refactor still planned to land before the freeze on Friday?",
      status: "sent",
      threadKey: "chat-jordan-pr204",
      directionId: null,
      request: null,
      originQueueItemId: null,
      sendSchedule: { mode: "batched", batchLabel: "11:00 AM batch", sentAt: hoursAgo(1.9) },
    },
    {
      id: "s-9",
      channel: "calendar",
      direction: "in",
      from: "calendar",
      to: "me",
      timestamp: hoursAgo(4),
      summary: "Accepted: Sprint planning, 2:00 PM",
      body: "Accepted: Sprint planning, 2:00 PM — recurring, no conflicts.",
      status: "closed",
      threadKey: null,
      directionId: null,
      request: null,
      resolution: "no conflict, auto-accepted",
    },
    {
      id: "s-10",
      channel: "sms",
      direction: "in",
      from: "+1 (555) 019-2231",
      to: "me",
      timestamp: hoursAgo(9),
      summary: "Your package has been delivered.",
      body: "Your package has been delivered.",
      status: "closed",
      threadKey: null,
      directionId: null,
      request: null,
      resolution: "filed, no action needed",
    },
    {
      id: "s-11",
      channel: "email",
      direction: "out",
      from: "me",
      to: "lin@demo.corp",
      timestamp: hoursAgo(20),
      summary: "Confirmed: moving standup to 10am tomorrow.",
      body: "Works for me — moving standup to 10am tomorrow. I'll update the invite.",
      status: "sent",
      threadKey: "t-standup",
      directionId: "demo/pm/scheduling",
      request: null,
      sendSchedule: { mode: "immediate", sentAt: hoursAgo(20) },
    },
    {
      id: "s-12",
      channel: "jira",
      direction: "out",
      from: "me",
      to: "jira-automation",
      timestamp: hoursAgo(28),
      summary: "Approved TICKET-4777 — PR opened and merged.",
      body: "Approved TICKET-4777 (CI timeout fix). PR opened, CI green, merged, deployed to staging.",
      status: "sent",
      threadKey: "TICKET-4777",
      directionId: "demo/eng/pr-pipeline",
      request: null,
      sendSchedule: { mode: "immediate", sentAt: hoursAgo(28) },
    },
  ],

  metrics: {
    window: "7d",
    signals: 34,
    thoughts: 6,
    ratio: 5.7,
    absorbed: 24,
    absorbRate: 0.71,
    overrideRate: 0.18,
    sendsWithoutRevert: 12,
  },
};
