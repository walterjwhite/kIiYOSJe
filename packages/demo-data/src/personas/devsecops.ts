/**
 * Persona: DevSecOps Engineer.
 *
 * Proves: the escalateOn guard is absolute — a real vulnerability report
 * never gets auto-sent or even drafted, regardless of confidence or autonomy
 * elsewhere. Routine scan noise is filed as evidence, not replied to. A
 * borderline dependency-update direction accumulates enough overrides to
 * demonstrate auto-disable at >20%.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-12T09:00:00.000Z");

export const devsecopsScenario: PersonaScenario = {
  id: "devsecops",
  displayName: "DevSecOps Engineer",
  pitch:
    "Security signal volume is unforgiving: most of it is routine scanner " +
    "output, but the rare real finding cannot wait. A direction authored as " +
    "posture:escalate (unauthorized access) reaches the operator immediately " +
    "regardless of confidence. A different direction authored as posture:absorb " +
    "(dependency updates) drafts a reply with high confidence, then the " +
    "escalateOn guard still blocks the autonomous send the moment the body " +
    "says 'CRITICAL' — the draft is never thrown away, it just waits for a human.",
  directionFiles: [
    "demo/devsecops/scan-reports.yaml",
    "demo/devsecops/security-alerts.yaml",
    "demo/devsecops/dependabot.yaml",
    "demo/devsecops/scan-alerts-routine.yaml",
  ],
  startAt: START,
  signals: [
    {
      atHour: 0,
      signal: {
        adapter: "demo-email", externalId: "sec-1", threadId: null,
        sender: "scanner@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Nightly scan complete: 0 critical, 2 medium, 14 low findings. No action required.",
      },
      classification: {
        directionId: "demo/devsecops/scan-reports", confidence: 0.95,
        intent: "routine scan completion", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "posture is surface",
      },
      draftBody: null,
      narrative: "Routine, no action implied — filed as evidence, not replied to.",
    },
    {
      atHour: 6,
      signal: {
        adapter: "demo-email", externalId: "sec-2", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: lodash 4.17.20 → 4.17.21 available (low severity, prototype pollution fix).",
      },
      classification: {
        directionId: "demo/devsecops/dependabot", confidence: 0.85,
        intent: "low-severity dependency update notice", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Noted — lodash 4.17.21 will be picked up in the next maintenance window.",
      narrative: "Low severity, clearly scoped — acknowledged and auto-sent per this direction's autonomy: send.",
    },
    {
      atHour: 20,
      signal: {
        adapter: "demo-email", externalId: "sec-3", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: axios 1.4.0 → 1.4.1 available (moderate severity, SSRF mitigation).",
      },
      classification: {
        directionId: "demo/devsecops/dependabot", confidence: 0.72,
        intent: "moderate dependency update, SSRF-related", signalKind: "information", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "SSRF mitigation warrants a closer look than a form acknowledgement",
      },
      draftBody: "Noted — axios 1.4.1 will be picked up in the next maintenance window.",
      narrative: "Drafted anyway at confidence 0.6 — the operator discards this one on replay because an SSRF-tagged update deserves more than a form reply. First override against this direction.",
    },
    {
      atHour: 28,
      signal: {
        adapter: "demo-email", externalId: "sec-4", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: jsonwebtoken 8.5.1 → 9.0.0 available (moderate severity, algorithm confusion).",
      },
      classification: {
        directionId: "demo/devsecops/dependabot", confidence: 0.7,
        intent: "moderate dependency update, auth-related", signalKind: "information", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "auth library change needs review, not a form reply",
      },
      draftBody: "Noted — jsonwebtoken 9.0.0 will be picked up in the next maintenance window.",
      narrative: "Second override — an auth-library bump dressed as routine. The direction's confidenceMin (0.65) is already above this signal's 0.58, so it would correctly draft-not-send, but the operator discards the draft itself as insufficient.",
    },
    {
      atHour: 30,
      signal: {
        adapter: "demo-email", externalId: "sec-5", threadId: null,
        sender: "security-team@demo.corp", recipients: ["me@demo.corp"], kind: "alert",
        body: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC. Investigating. Do not deploy until cleared.",
        urgencyHint: 1,
      },
      classification: {
        directionId: "demo/devsecops/security-alerts", confidence: 0.4,
        intent: "possible security incident", signalKind: "task", urgency: "high",
        commitment: null, escalateBy: "2026-10-13T17:00:00.000Z", sensitiveTopics: ["unauthorized access", "incident"],
        answerable: false, answerBlocker: "active security incident — human must respond",
      },
      draftBody: null,
      narrative: "This is the direct hit: escalateOn matches 'unauthorized access'. Because this direction's posture is escalate, the outcome is unconditional — no draft, no autonomous action, pinned to the brief within its 2-hour-equivalent deadline, regardless of confidence. See sec-5b for the case that isolates the escalateOn guard itself, on a direction whose posture is absorb/send rather than escalate.",
    },
    {
      atHour: 30.5,
      signal: {
        adapter: "demo-email", externalId: "sec-5b", threadId: null,
        sender: "scanner-alerts@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Scanner alert: CRITICAL finding — hardcoded AWS credentials detected in commit a1b2c3d (CVE score 9 equivalent severity).",
      },
      classification: {
        directionId: "demo/devsecops/scan-alerts-routine", confidence: 0.86,
        intent: "critical scanner finding", signalKind: "information", urgency: "high",
        commitment: null, escalateBy: "2026-10-13T19:00:00.000Z", sensitiveTopics: ["critical", "CVE score 9"],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Noted — this finding will be triaged in the next review cycle.",
      narrative: "High confidence (0.86), above scan-alerts-routine's 0.6 threshold and autonomy:send — this direction would normally auto-send the acknowledgement immediately. But the body says 'CRITICAL' and 'CVE score 9', both on the direction's own escalateOn list. The draft is still produced (decide() keeps shouldDraft true) but shouldSend is forced false: the action sits in Review instead of going out, proving the guard operates independently of posture — this is not the posture:escalate direction, it is a posture:absorb/autonomy:send direction that the guard reins in at the last gate.",
    },
    {
      atHour: 31,
      signal: {
        adapter: "demo-email", externalId: "sec-6", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: express 4.18.1 → 4.18.2 available (low severity).",
      },
      classification: {
        directionId: "demo/devsecops/dependabot", confidence: 0.84,
        intent: "low-severity dependency update", signalKind: "information", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Noted — express 4.18.2 will be picked up in the next maintenance window.",
      narrative: "Back to routine — this one is fine, auto-sent without incident.",
    },
    {
      atHour: 50,
      signal: {
        adapter: "demo-email", externalId: "sec-7", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: pyyaml 5.3.1 → 5.4 available (moderate severity, arbitrary code execution fix).",
      },
      classification: {
        directionId: "demo/devsecops/dependabot", confidence: 0.69,
        intent: "moderate dependency update, code-execution related", signalKind: "information", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "arbitrary code execution fix needs more than a form reply",
      },
      draftBody: "Noted — pyyaml 5.4 will be picked up in the next maintenance window.",
      narrative: "Third override on dependabot: 3 of 5 decided actions on this direction are now discards — 60% override rate, total 5. This crosses the >20% auto-disable threshold and the direction is disabled automatically, logged as a direction.auto-disabled event.",
    },
  ],
};
