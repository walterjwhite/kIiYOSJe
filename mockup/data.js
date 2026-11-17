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
 * not create signals itself. Some sources are DEMO FIRERS: enabling one
 * periodically injects a new signal on a timer, to make this mockup feel
 * alive instead of static, the same way a real connector would receive
 * real traffic.
 *
 * DIRECTIONS are the policies that decide posture/autonomy/confidence per
 * area of work — editable in their own Directions tab, same shape as the
 * real directions/*.yaml files. Each direction also carries a
 * `sendSchedule` describing the default timing for anything it approves
 * to send (batched at set times by default, not immediate).
 *
 * LEARNINGS are the durable history of every proposal the learning loop
 * has made (accepted or rejected), independent of `proposals` which only
 * holds the ones still pending a decision. They have their own tab.
 *
 * EVENTS are an append-only audit trail — one entry per thing that
 * actually happened (signal received, decision made, message sent,
 * direction edited, learning applied) — independent of and longer-lived
 * than the signals list, which only shows current signal state. This is
 * what the History view reads, filtered/searched, with a configurable
 * retention window.
 *
 * JOURNAL is a separate, append-only, human-written log — short notes the
 * operator adds themselves (not system-generated events). Entries cannot
 * be edited or deleted once added, only appended to, each stamped with
 * the date/time it was written.
 *
 * ASK-AI REQUESTS (`request.kind: "ask-ai-send"`) model asking the AI to
 * reach out on your behalf — "ask AI to ask a question over Teams" — as
 * opposed to you dictating the exact message. You give a goal and
 * instructions; the AI drafts the actual message (shown once drafted,
 * same approve/discard flow as any other approve-send signal), and once
 * approved it is scheduled according to the owning direction's
 * `sendSchedule`, not sent immediately. Replies come back as new
 * `exchange` entries on the same signal, and the AI can propose a
 * follow-up reply the same way it proposed the first message — this is a
 * conversation the AI is participating in, not a one-shot send.
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
  activeView: "queue", // "queue" | "today" | "signals" | "directions" | "direction-detail" | "learnings" | "analytics" | "journal" | "devices"
  logFilter: { channel: "all", direction: "all", text: "", range: "today" }, // range: "today" | "7d" | "30d" | "all"

  directions: [
    {
      id: "demo/pm/status-requests", name: "status-requests", posture: "absorb", autonomy: "draft", confidenceMin: 0.6,
      description: "Status/ETA questions from PM and leadership.", enabled: true,
      sendSchedule: { mode: "batched", times: ["09:00", "13:00", "17:00"] },
      matchPrompt: "Match if the sender is on the PM or leadership distribution list AND the message asks for a status, ETA, or progress update on a project, ticket, or release. Do not match general technical questions even if asked by a PM.",
      responsePrompt: "Answer factually from the most recent known status (ticket state, test results, release notes). If the real status is unknown or stale, say so plainly rather than guessing a date. Keep it to 2-3 sentences, no filler.",
    },
    {
      id: "demo/eng/pr-pipeline", name: "pr-pipeline", posture: "absorb", autonomy: "draft", confidenceMin: 0.7,
      description: "AI-implemented Jira tickets awaiting PR review.", enabled: true,
      sendSchedule: { mode: "batched", times: ["09:00", "17:00"] },
      matchPrompt: "Match any signal from jira-automation reporting that an AI-assisted implementation pass has finished for a ticket and is ready for review (tests run, adversarial review complete).",
      responsePrompt: "Summarize what was implemented, call out any adversarial-review flags explicitly, and recommend approve/needs-more-testing/reject based on confidence and whether tests are clean. Never recommend approving a flagged concern without addressing it first.",
    },
    {
      id: "demo/pm/vendor-noise", name: "vendor-noise", posture: "absorb", autonomy: "draft", confidenceMin: 0.55,
      description: "Inbound vendor/sales outreach.", enabled: false,
      sendSchedule: { mode: "batched", times: ["17:00"] },
      matchPrompt: "Match if the sender's domain is not an internal or known-partner domain AND the message reads as sales, vendor, or cold outreach rather than an existing working relationship.",
      responsePrompt: "Send a brief, polite acknowledgment that the message has been received and forwarded for review. Never commit to a call, a price, or a timeline.",
    },
    {
      id: "demo/devsecops/security-alerts", name: "security-alerts", posture: "escalate", autonomy: "observe", confidenceMin: 0.9,
      description: "Security monitoring alerts — always escalate, never auto-act.", enabled: true,
      sendSchedule: { mode: "immediate" },
      matchPrompt: "Match any signal from the security monitoring system flagged critical or containing 'unauthorized access', 'breach', or 'compromise'.",
      responsePrompt: "Never draft or send a response automatically. Run the triage steps the runbook defines, surface findings, and stop at any step requiring a credential only the operator holds.",
    },
    {
      id: "demo/devsecops/dependabot", name: "dependabot", posture: "absorb", autonomy: "draft", confidenceMin: 0.5,
      description: "Dependency vulnerability advisories.", enabled: true,
      sendSchedule: { mode: "batched", times: ["17:00"] },
      matchPrompt: "Match signals from the dependency-scanning bot reporting a single advisory with a severity rating.",
      responsePrompt: "Low severity: acknowledge and file for the next maintenance window without asking. Moderate or higher: draft an acknowledgment but always wait for approval, regardless of how many similar advisories were approved before.",
    },
    {
      id: "demo/pm/ask-ai", name: "ask-ai-requests", posture: "absorb", autonomy: "draft", confidenceMin: 0.6,
      description: "Messages you've asked the AI to compose and send on your behalf.", enabled: true,
      sendSchedule: { mode: "batched", times: ["09:00", "13:00", "17:00"] },
      matchPrompt: "Applies automatically to any signal created by the \"Write & schedule\" composer — not matched from inbound traffic.",
      responsePrompt: "Draft the message from the stated goal and any additional instructions given. Keep tone professional and concise, address the specific concern named in the goal, and never commit to something the goal didn't ask for.",
    },
  ],

  // ── Retention & history settings ────────────────────────────────────
  // Mirrors a future mind.history.retentionDays VS Code setting — mockup
  // only; the real retention job lives in packages/pipeline/src/retention.ts.
  historySettings: {
    retentionDays: 90,
  },

  // ── Learnings: durable record of every proposal the learning loop has
  // ever made and what happened to it. This is NOT a vector database or
  // an LLM summarizing anything — it's a periodic rule-based pass over
  // the `events` log (every decision made on every direction, inbound
  // and outbound signals alike): count overrides vs. unedited approvals
  // per direction over a rolling window, and propose a narrow/widen when
  // a threshold is crossed. See `learningRuns` below for what each pass
  // actually looked at. ───────────────────────────────────────────────
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

  // ── Learning runs: the actual periodic passes, so "how does this work"
  // has a concrete answer. Each run scans a window of `events` grouped
  // by directionId, counts sent/discarded/edited-before-send, and emits
  // a proposal only when override rate crosses the configured threshold
  // (20% by default) in either direction.
  learningRuns: [
    { id: "run-1", ranAt: "2026-11-16T06:00:00.000Z", windowDays: 14, directionsScanned: 6, eventsScanned: 58, proposalsEmitted: 2 },
    { id: "run-2", ranAt: "2026-11-09T06:00:00.000Z", windowDays: 14, directionsScanned: 6, eventsScanned: 51, proposalsEmitted: 1 },
    { id: "run-3", ranAt: "2026-11-02T06:00:00.000Z", windowDays: 14, directionsScanned: 5, eventsScanned: 44, proposalsEmitted: 0 },
  ],

  // ── Reclassifications: a record of signals that were moved from one
  // direction to another after the match turned out to be wrong — e.g. a
  // vague subject line got matched to vendor-noise when it was really a
  // status request. Kept as its own log so a mismatch is visible as a
  // correction, not silently lost.
  reclassifications: [
    {
      id: "rc-1",
      signalId: "s-6",
      timestamp: "2026-11-11T10:00:00.000Z",
      fromDirectionId: "demo/pm/vendor-noise",
      toDirectionId: "demo/devsecops/dependabot",
      reason: "Subject line looked like generic outreach but the sender and content were clearly a Dependabot advisory — matcher confused by a vendor-like sender name.",
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
  // project, a number); it does not create test data on its own. Sources
  // with `firer` are demo connectors: enabling one periodically generates
  // a believable new signal on that channel, standing in for the real
  // connectors TODO.md calls for (Teams, Outlook, Gmail, SMS, Calendar,
  // Confluence, Jira, Git, CI) until those are built for real.
  sources: [
    {
      id: "src-1", channel: "email", label: "me@demo.corp (primary inbox)", enabled: true, health: "connected",
      firer: { kind: "email-pm", minMs: 45000, maxMs: 90000 },
    },
    {
      id: "src-2", channel: "jira", label: "demo.corp Jira — automation webhook", enabled: true, health: "connected",
      firer: { kind: "jira-ticket", minMs: 60000, maxMs: 120000 },
    },
    {
      id: "src-3", channel: "chat", label: "Teams / Slack — #eng-oncall + DMs", enabled: true, health: "connected",
      firer: { kind: "chat-ping", minMs: 30000, maxMs: 70000 },
    },
    { id: "src-4", channel: "calendar", label: "me@demo.corp calendar", enabled: true, health: "connected" },
    { id: "src-5", channel: "sms", label: "+1 (555) 019-2231", enabled: false, health: "disconnected" },
    { id: "src-6", channel: "confluence", label: "demo.corp Confluence — Engineering space", enabled: true, health: "connected" },
    { id: "src-7", channel: "github", label: "github.com/demo-corp/platform", enabled: true, health: "connected" },
    { id: "src-8", channel: "ci", label: "GitHub Actions — platform CI", enabled: true, health: "erroring" },
  ],

  // ── Demo mode: when on, enabled sources with a `firer` periodically
  // inject a new signal, so the mockup keeps producing believable traffic
  // instead of sitting static. Purely a mockup convenience — stands in
  // for "real connectors receiving real events."
  demoMode: { enabled: false, firedCount: 0 },

  // ── Journal: append-only, operator-written notes. Distinct from
  // `events` (system-generated audit trail) — these are short notes the
  // person adds themselves, timestamped on write, never edited or
  // removed once added. Matches TODO.md Foundations #5.
  journal: [
    { id: "j-1", timestamp: "2026-11-08T08:12:00.000Z", text: "Decided to keep security-alerts on posture: escalate indefinitely — too risky to automate even with a good track record." },
    { id: "j-2", timestamp: "2026-11-12T16:40:00.000Z", text: "Vendor-noise direction is still too chatty. Watching override rate before deciding whether to narrow confidenceMin again." },
  ],

  // ── Knowledge base seed — TODO.md section 7. A durable, searchable
  // record of ingested material, answerable with citations.
  knowledge: [
    { id: "k-1", title: "Runbook: rotating production database credentials", source: "Confluence — Engineering / Runbooks", updatedAt: "2026-10-28T00:00:00.000Z", url: "https://confluence.demo.corp/runbooks/db-creds" },
    { id: "k-2", title: "Decision record: why pr-pipeline drafts instead of auto-sending", source: "Confluence — Engineering / Decisions", updatedAt: "2026-10-05T00:00:00.000Z", url: "https://confluence.demo.corp/decisions/pr-pipeline-autonomy" },
    { id: "k-3", title: "TICKET-4821 — rate-limit bypass for internal service accounts", source: "Jira", updatedAt: "2026-11-15T10:00:00.000Z", url: "https://jira.demo.corp/browse/TICKET-4821" },
  ],

  // ── Guidance/requests — TODO.md section 8. Work the operator asked for
  // from any client; moves waiting -> running -> done/failed/cancelled.
  requests: [
    { id: "r-1", askedAt: "2026-11-16T07:00:00.000Z", text: "Draft a reply to the vendor payment-terms email once you've checked our current contract renewal date.", status: "done", resultSignalId: "s-5" },
    { id: "r-2", askedAt: "2026-11-16T09:30:00.000Z", text: "Summarize what changed in TICKET-4821 since last review.", status: "running" },
  ],

  // ── Paired devices — TODO.md section 5 (multiple clients, one state).
  // Pairing a new device (e.g. the future Android app) generates a
  // short-lived code shown here; entering it on the other device (not
  // modeled — there is no other device in a mockup) would complete the
  // pairing. Revoking a device is immediate and independent of others.
  devices: [
    { id: "dev-1", name: "This editor (VS Code)", kind: "editor", pairedAt: "2026-09-01T00:00:00.000Z", scopes: ["read", "capture", "send", "render", "settings"], lastSeen: null },
  ],
  pendingPairing: null, // { code, expiresAt } while a pairing code is active

  // ── Daily brief settings — TODO.md section 6.
  briefSettings: { time: "08:00", voice: "default", audioEnabled: true },

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
      timestamp: hoursAgo(1.3),
      summary: "Does the new auth middleware apply to service-to-service calls?",
      body: "Does the new auth middleware apply to internal service-to-service calls, or only external requests?",
      status: "closed",
      threadKey: "chat-priya-auth",
      directionId: null,
      thoughtId: "th-1",
      runningState: null,
      request: null,
      resolution: "answered directly after a short back-and-forth — informational only, no action",
      // Multi-turn 1:1 — realistic back-and-forth before the question was
      // actually answered, not a single message each way.
      exchange: [
        { from: "priya@demo.corp", body: "Does the new auth middleware apply to internal service-to-service calls, or only external requests?", timestamp: hoursAgo(1.3) },
        { from: "me", body: "Internal calls too, with one exception for calls carrying a valid service-account token.", timestamp: hoursAgo(1.27) },
        { from: "priya@demo.corp", body: "Which token exactly — the one minted by the platform auth service, or any signed JWT?", timestamp: hoursAgo(1.2) },
        { from: "me", body: "Specifically the platform auth service's service-account token — a generic signed JWT won't match the bypass check.", timestamp: hoursAgo(1.15) },
        { from: "priya@demo.corp", body: "Got it. So billing-sync should still be enforcing the full check against anything else, right?", timestamp: hoursAgo(1.05) },
        { from: "me", body: "That's the intent — though the adversarial review on TICKET-4821 just flagged that billing-sync returned a 200 instead of 403 on a spoofed header, so it needs a second look before you rely on that.", timestamp: hoursAgo(0.95) },
        { from: "priya@demo.corp", body: "Ah — thanks for the heads up, I'll hold off referencing it as hardened until that's resolved.", timestamp: hoursAgo(0.9) },
      ],
    },

    // ── Group chat, split into one Signal per topic. Same room, same
    // participants pool, but two separate threads — a group chat is not
    // one conversation just because it's one room. Only the topic that
    // concerns the operator carries a `request` and appears in the Queue;
    // the unrelated topic is purely informational and never did.
    {
      id: "s-16",
      channel: "chat",
      direction: "in",
      from: "jordan@demo.corp",
      to: "me",
      timestamp: hoursAgo(2.6),
      summary: "#eng-platform: is the rate-limit bypass safe to demo Thursday?",
      body: "Is the rate-limit bypass (TICKET-4821) safe to demo Thursday, given the auth-header-spoofing concern.",
      status: "open",
      threadKey: "group-eng-platform-demo-safety",
      directionId: null,
      thoughtId: "th-1",
      needsLinking: false,
      runningState: null,
      room: "#eng-platform",
      participants: ["jordan@demo.corp", "priya@demo.corp", "sam-qe@demo.corp", "pm-lead@demo.corp", "owner-dana@demo.corp", "me"],
      request: {
        kind: "needs-link",
        urgencyScore: 42,
        escalateBy: hoursFromNow(20),
        reason: "This topic in #eng-platform is asking you directly whether the rate-limit bypass is safe to demo — it's about TICKET-4821 but the question itself (demo readiness) isn't tracked anywhere yet.",
        context: {},
      },
      exchange: [
        { from: "jordan@demo.corp", body: "Is the rate-limit bypass (TICKET-4821) safe to demo Thursday, given the auth-header-spoofing concern that came up in review?", timestamp: hoursAgo(2.6) },
        { from: "sam-qe@demo.corp", body: "I re-ran the spoofed-header test this morning against staging.", timestamp: hoursAgo(2.55) },
        { from: "sam-qe@demo.corp", body: "Billing-sync still returns a 200 instead of 403 — that part isn't fixed yet.", timestamp: hoursAgo(2.54) },
        { from: "sam-qe@demo.corp", body: "Everything else in the bypass path looks correct though, including the internal service-account exemption.", timestamp: hoursAgo(2.53) },
        { from: "pm-lead@demo.corp", body: "Can we demo the parts that are solid and just avoid touching billing-sync live?", timestamp: hoursAgo(2.4) },
        { from: "owner-dana@demo.corp", body: "I'd rather we hold the demo for that ticket specifically until the 403 is confirmed — don't want to explain a security gap live.", timestamp: hoursAgo(2.3) },
        { from: "jordan@demo.corp", body: "@me — can you make the call on whether to demo it Thursday or push it?", timestamp: hoursAgo(2.2) },
      ],
    },
    // Separate topic, same room — a different engineer asking the QE
    // something unrelated. No request, never enters the Queue; still its
    // own row in Signals, and clicking it opens its own conversation.
    {
      id: "s-17",
      channel: "chat",
      direction: "in",
      from: "lin@demo.corp",
      to: "sam-qe@demo.corp",
      timestamp: hoursAgo(1.1),
      summary: "#eng-platform: test/rate-limit.test.ts flaking on CI",
      body: "Anyone else seeing test/rate-limit.test.ts flake on CI the last two days?",
      status: "closed",
      threadKey: "group-eng-platform-flaky-test",
      directionId: null,
      thoughtId: null,
      needsLinking: false,
      runningState: null,
      room: "#eng-platform",
      participants: ["lin@demo.corp", "sam-qe@demo.corp"],
      request: null,
      resolution: "resolved between Lin and the QE — timeout bumped, root cause ticketed for next sprint; did not involve the operator",
      exchange: [
        { from: "lin@demo.corp", body: "Separate thing — anyone else seeing test/rate-limit.test.ts flake on CI the last two days?", timestamp: hoursAgo(1.1) },
        { from: "sam-qe@demo.corp", body: "Yeah, saw it fail twice yesterday. Looks timing-related, not a real regression.", timestamp: hoursAgo(1.05) },
        { from: "lin@demo.corp", body: "Want me to bump the timeout or do you want to look at the root cause first?", timestamp: hoursAgo(1.0) },
        { from: "sam-qe@demo.corp", body: "Bump the timeout for now, I'll file a ticket to look at the root cause next sprint.", timestamp: hoursAgo(0.95) },
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

    // ── Ask-AI example — operator asked the AI to clarify something over
    // chat rather than dictating the exact wording; AI drafted the
    // message, it's awaiting approval, and once approved it will follow
    // ask-ai-requests' batched send schedule rather than go immediately.
    {
      id: "s-15",
      channel: "chat",
      direction: "out",
      from: "me",
      to: "priya@demo.corp",
      timestamp: hoursAgo(0.3),
      summary: "Ask AI: clarify whether the rate-limit bypass needs a feature flag before merge.",
      body: "Asked the AI to find out from Priya whether the rate-limit bypass (TICKET-4821) needs to go behind a feature flag before merging, given the auth-header-spoofing concern.",
      status: "open",
      threadKey: "chat-priya-auth",
      directionId: "demo/pm/ask-ai",
      thoughtId: "th-1",
      runningState: null,
      askAi: {
        goal: "Find out whether TICKET-4821's rate-limit bypass needs a feature flag before merge, given the adversarial review's auth-header-spoofing concern.",
        instructions: "Keep it short, reference the specific concern, and ask Priya directly since she owns the auth middleware.",
        askedAt: hoursAgo(0.3),
      },
      request: {
        kind: "approve-send",
        urgencyScore: 40,
        escalateBy: hoursFromNow(6),
        reason: "ask-ai-requests is set to autonomy: draft — the AI drafted this message for the question you asked it to send, and it still waits for your approval before going out, same as any other reply.",
        context: {
          draft: "Hey Priya — given the auth-header-spoofing concern the adversarial review flagged on TICKET-4821, should the rate-limit bypass go behind a feature flag before we merge, or are you comfortable shipping it directly once the concern's addressed?",
        },
      },
      exchange: [
        { from: "me", body: "(asked AI to find out whether the bypass needs a feature flag before merge)", timestamp: hoursAgo(0.3) },
      ],
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
    { id: "ev-11", timestamp: hoursAgo(0.95), kind: "received", channel: "chat", person: "sam-qe@demo.corp", summary: "#eng-platform flaky-test thread resolved between Lin and QE — timeout bumped.", signalId: "s-17" },
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
    // Per-direction breakdown for the Analytics tab — volume handled,
    // how often a draft needed editing or rejecting, and a rough
    // estimate of time saved (absorbed + unedited-approved signals
    // times an assumed 4 minutes each if the operator had done it by hand).
    byDirection: [
      { directionId: "demo/pm/status-requests", handled: 9, overridden: 1, minutesSavedEst: 32 },
      { directionId: "demo/eng/pr-pipeline", handled: 8, overridden: 1, minutesSavedEst: 28 },
      { directionId: "demo/pm/vendor-noise", handled: 4, overridden: 4, minutesSavedEst: 4 },
      { directionId: "demo/devsecops/security-alerts", handled: 2, overridden: 0, minutesSavedEst: 0 },
      { directionId: "demo/devsecops/dependabot", handled: 5, overridden: 0, minutesSavedEst: 20 },
      { directionId: "demo/pm/ask-ai", handled: 3, overridden: 0, minutesSavedEst: 9 },
    ],
    byChannel: [
      { channel: "email", count: 15 },
      { channel: "chat", count: 11 },
      { channel: "jira", count: 5 },
      { channel: "calendar", count: 1 },
      { channel: "sms", count: 1 },
      { channel: "ci", count: 1 },
    ],
    dailyVolume: [
      { date: "2026-11-10", count: 3 }, { date: "2026-11-11", count: 5 }, { date: "2026-11-12", count: 4 },
      { date: "2026-11-13", count: 6 }, { date: "2026-11-14", count: 5 }, { date: "2026-11-15", count: 4 },
      { date: "2026-11-16", count: 7 },
    ],
  },
};
