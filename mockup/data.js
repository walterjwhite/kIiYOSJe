/**
 * Fake data for the mind extension mockup — signal-centric redesign.
 *
 * Everything is a SIGNAL. A signal has a common envelope:
 *   id, channel, direction ("in"|"out"), from, to, timestamp, summary, status
 *
 * A signal that still needs a decision also carries `request`:
 *   { kind: "approve-send" | "external-review" | "needs-credential" | "needs-link",
 *     urgencyScore, threadKey, escalateBy, reason, context }
 *
 * `reason` is a short, always-present explanation of *why this needed you*
 * instead of being handled automatically — a posture/autonomy setting on
 * the matching direction, a confidence score below threshold, a credential
 * only the operator holds, or (for "needs-link") a reference to work that
 * isn't tracked anywhere yet. The AI is always attempting to resolve
 * signals on its own first; `reason` is where it explains why it stopped.
 *
 * `context` is intentionally open-ended beyond that. For an
 * "external-review" signal it is whatever the originating system (a Jira
 * automation, a CI pipeline, a monitoring tool) chose to report about its
 * own work. For a "needs-credential" signal, context carries what the
 * AI-driven triage already did before it hit a wall it cannot pass without
 * you — in this example, prod access requires an OTP only you have. Once
 * provided, the triage resumes on its own; the UI does not do the triage,
 * it only passes the credential back to whatever is running it.
 *
 * `runningState` ({ label, startedAt }) marks a signal whose decision has
 * already been made but whose follow-through is still in progress in the
 * background (a resumed triage, a send working through the pipeline). A
 * signal with runningState stays visible in the Queue, in place, shown as
 * disabled with a running indicator — it only leaves the Queue once the
 * background work reports back with either nothing further needed (closes,
 * moves to Signals) or a new decision (reopens with a fresh request).
 *
 * THOUGHTS are the larger items signals attach to. For work, this is
 * usually a ticket, issue, or task; informational signals (an incident
 * writeup, a newsletter, an announcement) link to a plain thought instead.
 * A "dangling" signal — one that references something not yet tracked —
 * gets a synthetic `request.kind: "needs-link"` so it shows up in the
 * Queue like anything else that owes you a decision, instead of only
 * existing in Signals where it could go unnoticed indefinitely.
 *
 * SOURCES are the connectors signals arrive through (an inbox, a Jira
 * webhook, a phone number) — configuring one wires up a channel, it does
 * not create signals itself.
 *
 * DIRECTIONS are the policies that decide posture/autonomy/confidence per
 * area of work — editable here via a Directions panel, same shape as the
 * real directions/*.yaml files.
 *
 * LEARNINGS are the durable history of every proposal the learning loop
 * has made (accepted or rejected), independent of `proposals` which only
 * holds the ones still pending a decision.
 *
 * EVENTS are an append-only audit trail — one entry per thing that
 * actually happened (signal received, decision made, message sent,
 * direction edited, learning applied) — independent of and longer-lived
 * than the signals list, which only shows current signal state. This is
 * what the History view reads, filtered/searched, with a configurable
 * retention window.
 *
 * Signals with no `request` already happened — no decision is pending.
 * They appear only in Signals, never in the Queue.
 */

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const hoursFromNow = (h) => new Date(now + h * 3600_000).toISOString();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

window.MOCK_STATE = {
  serverUrl: "http://127.0.0.1:8787",
  aiProvider: "ollama",
  aiModel: "qwen2.5:3b-instruct",
  // Mirrors the real mind.ai.* VS Code settings — mockup-only, nothing here
  // is enforced; it just demonstrates the controls and a sample usage read.
  aiBudgets: {
    timeBudgetMsPerTask: 60000,
    tokenBudgetPerTask: 8000,
    tokenBudgetPerDay: 200000,
    onBudgetExceeded: "pause",
    tokensUsedToday: 46200,
  },
  paused: false,
  sortMode: "urgency", // "urgency" | "flow"
  selectedSignalId: null,
  activeView: "queue", // "queue" | "today" | "signals" | "history"
  logFilter: { channel: "all", direction: "all" },
  historyFilter: { channel: "all", person: "", text: "", dateFrom: "", dateTo: "" },

  directions: [
    { id: "demo/pm/status-requests", name: "status-requests", posture: "absorb", autonomy: "draft", confidenceMin: 0.6, description: "Status/ETA questions from PM and leadership.", enabled: true },
    { id: "demo/eng/pr-pipeline", name: "pr-pipeline", posture: "absorb", autonomy: "draft", confidenceMin: 0.7, description: "AI-implemented Jira tickets awaiting PR review.", enabled: true },
    { id: "demo/pm/vendor-noise", name: "vendor-noise", posture: "absorb", autonomy: "draft", confidenceMin: 0.55, description: "Inbound vendor/sales outreach.", enabled: false },
    { id: "demo/devsecops/security-alerts", name: "security-alerts", posture: "escalate", autonomy: "observe", confidenceMin: 0.9, description: "Security monitoring alerts — always escalate, never auto-act.", enabled: true },
    { id: "demo/devsecops/dependabot", name: "dependabot", posture: "absorb", autonomy: "draft", confidenceMin: 0.5, description: "Dependency vulnerability advisories.", enabled: true },
  ],

  // ── Retention & history settings ────────────────────────────────────
  // Mirrors a future mind.history.retentionDays VS Code setting — mockup
  // only; the real retention job lives in packages/pipeline/src/retention.ts.
  historySettings: {
    retentionDays: 90,
  },

  // ── Learnings: durable record of every proposal the learning loop has
  // ever made and what happened to it, plus a derived view of what's
  // currently in effect on each direction as a result of past accepts. ──
  learnings: [
    {
      id: "l-1",
      appliedAt: "2026-10-02T14:00:00.000Z",
      directionId: "demo/pm/vendor-noise",
      field: "confidenceMin",
      fromValue: 0.4,
      toValue: 0.5,
      rationale: "Override rate 35% over 12 actions exceeded the 20% threshold — narrowed to require higher confidence before drafting.",
      status: "accepted",
    },
    {
      id: "l-2",
      appliedAt: "2026-10-18T09:30:00.000Z",
      directionId: "demo/eng/pr-pipeline",
      field: "autonomy",
      fromValue: "observe",
      toValue: "draft",
      rationale: "5 of 5 ticket reviews approved without edits — widened from observe-only to drafting PRs automatically.",
      status: "accepted",
    },
    {
      id: "l-3",
      appliedAt: "2026-11-05T11:15:00.000Z",
      directionId: "demo/devsecops/dependabot",
      field: "confidenceMin",
      fromValue: 0.6,
      toValue: 0.45,
      rationale: "100% of moderate-severity drafts approved unedited over 3 weeks — proposed narrowing the gate further.",
      status: "rejected",
      rejectedReason: "Kept the higher bar deliberately — security advisories stay conservative even with a clean track record.",
    },
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

  // ── Thoughts: the larger item a signal can be linked to ───────────────
  // kind is either work (ticket/issue/task — anything that tracks back to
  // engineering work) or informational (incident/thought/newsletter —
  // things worth remembering but with no task behind them).
  thoughts: [
    { id: "th-1", kind: "ticket", title: "TICKET-4821 — rate-limit bypass for internal service accounts" },
    { id: "th-2", kind: "ticket", title: "TICKET-4790 — fix flaky integration suite timeout" },
    { id: "th-3", kind: "incident", title: "Staging DB unauthorized access investigation" },
  ],

  // ── Signal sources: the connectors that feed signals in, not the signals
  // themselves. Adding a source wires up a channel (an inbox, a Jira
  // project, a number); it does not create test data on its own.
  sources: [
    { id: "src-1", channel: "email", label: "me@demo.corp (primary inbox)", enabled: true },
    { id: "src-2", channel: "jira", label: "demo.corp Jira — automation webhook", enabled: true },
    { id: "src-3", channel: "chat", label: "Slack — #eng-oncall + DMs", enabled: true },
    { id: "src-4", channel: "calendar", label: "me@demo.corp calendar", enabled: true },
    { id: "src-5", channel: "sms", label: "+1 (555) 019-2231", enabled: false },
  ],

  // ── Signals: the one object model, inbound and outbound, all channels ──
  signals: [
    {
      id: "s-1",
      channel: "email",
      direction: "in",
      from: "security-team@demo.corp",
      to: "me",
      timestamp: minutesAgo(14),
      summary: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC.",
      body: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC. Investigating. Do not deploy until cleared.",
      status: "open",
      threadKey: "incident-staging-db",
      directionId: "demo/devsecops/security-alerts",
      thoughtId: "th-3",
      runningState: null,
      request: {
        kind: "needs-credential",
        urgencyScore: 100,
        escalateBy: hoursAgo(0),
        reason: "security-alerts is set to posture: escalate — the triage ran on its own as far as it could, but prod access requires your OTP; this direction never attempts that step without you.",
        context: {
          triagePriorSteps: [
            { name: "Classify alert", status: "done", detail: "Matched escalateOn: 'unauthorized access' — severity: critical" },
            { name: "Pull recent auth logs", status: "done", detail: "14 failed login attempts from 3 distinct IPs in the last hour, all against the staging DB service account" },
            { name: "Check recent deploys", status: "done", detail: "No deploys to staging in the last 6 hours — rules out a bad release as the cause" },
            { name: "Cross-reference known IPs", status: "done", detail: "2 of 3 source IPs are not on the office or VPN allowlist" },
            { name: "Access prod audit trail to compare", status: "blocked", detail: "Requires interactive login with OTP — triage cannot proceed without it" },
          ],
          credentialPrompt: "Enter your current OTP to let the triage continue into the prod audit trail.",
          afterReceived: "Triage resumes automatically: cross-references the same IPs against prod, and will escalate further only if it finds a match.",
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
      thoughtId: "th-1",
      runningState: null,
      request: {
        kind: "external-review",
        urgencyScore: 62,
        escalateBy: hoursFromNow(4),
        reason: "confidence 0.38 is below pr-pipeline's 0.70 auto-proceed threshold — the adversarial review flagged a possible auth bypass, so this needs your judgment before it continues.",
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
      thoughtId: "th-2",
      runningState: null,
      request: {
        kind: "external-review",
        urgencyScore: 30,
        escalateBy: null,
        reason: "confidence 0.88 clears the auto-proceed threshold, but pr-pipeline's autonomy is still set to draft — every PR waits for one approval regardless of confidence until you widen that direction.",
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
          notes: "No issues found in the adversarial pass.",
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
      thoughtId: null,
      runningState: null,
      request: {
        kind: "approve-send",
        urgencyScore: 45,
        escalateBy: hoursFromNow(18),
        reason: "status-requests is set to autonomy: draft — this director is external to the immediate team, so every reply drafts and waits for your approval regardless of how confident the draft is.",
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
      thoughtId: null,
      runningState: null,
      request: {
        kind: "approve-send",
        urgencyScore: 15,
        escalateBy: null,
        reason: "vendor-noise is set to autonomy: draft for all external vendor contacts — low urgency, but still routed through you rather than sent automatically.",
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
      thoughtId: null,
      runningState: null,
      request: {
        kind: "approve-send",
        urgencyScore: 10,
        escalateBy: null,
        reason: "dependabot's autonomy is draft for moderate-severity findings — it would auto-acknowledge low severity on its own, but moderate still waits for you once per advisory.",
        context: {
          draft: "Acknowledged. The minimist update (prototype pollution fix) will be reviewed in the next maintenance window.",
        },
      },
    },

    // ── Chat signals — exchange visible both ways, one still dangling ────
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
      thoughtId: "th-1",
      runningState: null,
      request: null,
      resolution: "answered directly — informational only, no action",
      exchange: [
        { from: "priya@demo.corp", body: "Does the new auth middleware apply to internal service-to-service calls, or only external requests?", timestamp: hoursAgo(1) },
        { from: "me", body: "Internal calls too — the bypass in TICKET-4821 only exempts calls carrying a valid service-account token, everything else still goes through the full check.", timestamp: hoursAgo(0.9) },
      ],
    },
    {
      id: "s-13",
      channel: "chat",
      direction: "in",
      from: "jordan@demo.corp",
      to: "me",
      timestamp: hoursAgo(0.6),
      summary: "Did you see the billing sync route returned a 200 on the spoofed header test?",
      body: "Did you see the billing sync route returned a 200 on the spoofed header test? Might be worth its own ticket.",
      status: "open",
      threadKey: "chat-jordan-billing-200",
      directionId: null,
      thoughtId: null,
      needsLinking: true,
      runningState: null,
      request: {
        kind: "needs-link",
        urgencyScore: 38,
        escalateBy: null,
        reason: "This references possible work (a security gap on the billing sync route) that isn't tracked as a ticket or thought yet — it stays in the queue until you link it to one or dismiss it as not actionable.",
        context: {},
      },
      exchange: [
        { from: "jordan@demo.corp", body: "Did you see the billing sync route returned a 200 on the spoofed header test? Might be worth its own ticket.", timestamp: hoursAgo(0.6) },
      ],
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
      thoughtId: null,
      request: null,
      sendSchedule: { mode: "batched", batchLabel: "11:00 AM batch", sentAt: hoursAgo(1.9) },
      exchange: [
        { from: "me", body: "Is PR #204's rate-limit refactor still planned to land before the freeze on Friday?", timestamp: hoursAgo(1.9) },
        { from: "jordan@demo.corp", body: "Yep, on track — should merge by Thursday EOD.", timestamp: hoursAgo(1.5) },
      ],
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
      thoughtId: null,
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
      thoughtId: null,
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
      thoughtId: null,
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
      thoughtId: null,
      request: null,
      sendSchedule: { mode: "immediate", sentAt: hoursAgo(28) },
    },
    {
      id: "s-14",
      channel: "email",
      direction: "in",
      from: "ops-lead@demo.corp",
      to: "me",
      timestamp: hoursAgo(0.1),
      summary: "Can you confirm the rollback plan for tonight's deploy?",
      body: "Can you confirm the rollback plan for tonight's deploy? Want to make sure ops has it before we start.",
      status: "open",
      threadKey: "t-rollback-plan",
      directionId: "demo/pm/status-requests",
      thoughtId: null,
      runningState: { label: "Sending — next scheduled batch", startedAt: hoursAgo(0.05) },
      request: {
        kind: "approve-send",
        urgencyScore: 55,
        escalateBy: hoursFromNow(2),
        reason: "status-requests is set to autonomy: draft — already approved, now waiting on the next scheduled send batch. No further decision needed unless the send fails.",
        context: {
          draft: "Rollback plan: revert to the last tagged release (v2.14.3), re-run the smoke suite, and page #eng-oncall if health checks don't clear within 5 minutes.",
        },
      },
    },
  ],

  // ── History: an append-only audit trail, independent of current signal
  // state. One entry per thing that actually happened, searchable by date
  // range, free text, source (channel), and person. Retention is governed
  // by historySettings.retentionDays — entries older than that are pruned
  // (modeled here by filtering at render time against a fake "now").
  events: [
    { id: "ev-1", timestamp: hoursAgo(28), kind: "sent", channel: "jira", person: "jira-automation", summary: "Approved TICKET-4777 — PR opened and merged.", signalId: "s-12" },
    { id: "ev-2", timestamp: hoursAgo(20), kind: "sent", channel: "email", person: "lin@demo.corp", summary: "Confirmed: moving standup to 10am tomorrow.", signalId: "s-11" },
    { id: "ev-3", timestamp: hoursAgo(9), kind: "received", channel: "sms", person: "+1 (555) 019-2231", summary: "Your package has been delivered.", signalId: "s-10" },
    { id: "ev-4", timestamp: hoursAgo(4), kind: "received", channel: "calendar", person: "calendar", summary: "Accepted: Sprint planning, 2:00 PM", signalId: "s-9" },
    { id: "ev-5", timestamp: hoursAgo(1.9), kind: "sent", channel: "chat", person: "jordan@demo.corp", summary: "Asked whether PR #204 lands before the Friday freeze.", signalId: "s-8" },
    { id: "ev-6", timestamp: hoursAgo(1), kind: "received", channel: "chat", person: "priya@demo.corp", summary: "Answered: does the new auth middleware apply to service-to-service calls?", signalId: "s-7" },
    { id: "ev-7", timestamp: "2026-10-02T14:00:00.000Z", kind: "learning-applied", channel: null, person: "learning loop", summary: "Narrowed vendor-noise confidenceMin from 0.40 to 0.50.", learningId: "l-1" },
    { id: "ev-8", timestamp: "2026-10-18T09:30:00.000Z", kind: "learning-applied", channel: null, person: "learning loop", summary: "Widened pr-pipeline autonomy from observe to draft.", learningId: "l-2" },
    { id: "ev-9", timestamp: "2026-11-05T11:20:00.000Z", kind: "learning-rejected", channel: null, person: "me", summary: "Rejected proposal to narrow dependabot confidenceMin to 0.45.", learningId: "l-3" },
    { id: "ev-10", timestamp: "2026-11-10T08:00:00.000Z", kind: "direction-edited", channel: null, person: "me", summary: "Enabled security-alerts, set posture to escalate.", directionId: "demo/devsecops/security-alerts" },
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
