/**
 * Persona: DevSecOps Engineer.
 *
 * Fake signals, real decisions. security-alerts is posture:escalate, so a
 * genuine security message should reach the operator unconditionally no
 * matter what the classifier returns. dependabot and scan-alerts-routine
 * are posture:absorb/autonomy:send directions with an escalateOn guard —
 * whatever the model drafts for a severe-sounding update, the guard should
 * still block the autonomous send if the body trips it.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-12T09:00:00.000Z");

export const devsecopsScenario: PersonaScenario = {
  id: "devsecops",
  displayName: "DevSecOps Engineer",
  pitch:
    "Security signal volume is unforgiving: most of it is routine scanner " +
    "output, but the rare real finding cannot wait. Whether the model " +
    "drafts, auto-sends, or the escalateOn guard blocks a send entirely " +
    "depends on the real classification of each signal — not a script.",
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
      era: "historical",
      intent: "routine scan completion, no action implied",
      signal: {
        adapter: "demo-email", externalId: "sec-1", threadId: null,
        sender: "scanner@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Nightly scan complete: 0 critical, 2 medium, 14 low findings. No action required.",
      },
    },
    {
      atHour: 6,
      era: "historical",
      intent: "low-severity dependency update",
      signal: {
        adapter: "demo-email", externalId: "sec-2", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: lodash 4.17.20 → 4.17.21 available (low severity, prototype pollution fix).",
      },
    },
    {
      atHour: 20,
      era: "historical",
      intent: "moderate-severity update, SSRF-related — may warrant more than a form reply",
      signal: {
        adapter: "demo-email", externalId: "sec-3", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: axios 1.4.0 → 1.4.1 available (moderate severity, SSRF mitigation).",
      },
    },
    {
      atHour: 28,
      era: "historical",
      intent: "moderate-severity update, auth-related",
      signal: {
        adapter: "demo-email", externalId: "sec-4", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: jsonwebtoken 8.5.1 → 9.0.0 available (moderate severity, algorithm confusion).",
      },
    },
    {
      atHour: 30,
      era: "historical",
      intent: "genuine security incident — exercises security-alerts (posture: escalate)",
      signal: {
        adapter: "demo-email", externalId: "sec-5", threadId: null,
        sender: "security-team@demo.corp", recipients: ["me@demo.corp"], kind: "alert",
        body: "URGENT: possible unauthorized access detected on the staging database at 05:14 UTC. Investigating. Do not deploy until cleared.",
        urgencyHint: 1,
      },
    },
    {
      atHour: 30.5,
      era: "historical",
      intent: "critical scanner finding on a send-capable direction — exercises the escalateOn guard specifically",
      signal: {
        adapter: "demo-email", externalId: "sec-5b", threadId: null,
        sender: "scanner-alerts@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Scanner alert: CRITICAL finding — hardcoded AWS credentials detected in commit a1b2c3d (CVE score 9 equivalent severity).",
      },
    },
    {
      atHour: 31,
      era: "historical",
      intent: "routine low-severity update",
      signal: {
        adapter: "demo-email", externalId: "sec-6", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: express 4.18.1 → 4.18.2 available (low severity).",
      },
    },
    {
      atHour: 50,
      era: "historical",
      intent: "moderate-severity update, code-execution related",
      signal: {
        adapter: "demo-email", externalId: "sec-7", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: pyyaml 5.3.1 → 5.4 available (moderate severity, arbitrary code execution fix).",
      },
    },
    // ── live era — left unresolved for the operator to act on ──────────────
    {
      atHour: 0,
      era: "live",
      intent: "fresh moderate-severity dependency update",
      signal: {
        adapter: "demo-email", externalId: "sec-8", threadId: null,
        sender: "dependabot@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Dependabot: minimist 1.2.5 → 1.2.8 available (moderate severity, prototype pollution).",
      },
    },
    {
      atHour: 0,
      era: "live",
      intent: "fresh scan report, plausibly routine",
      signal: {
        adapter: "demo-email", externalId: "sec-9", threadId: null,
        sender: "scanner@demo.corp", recipients: ["me@demo.corp"], kind: "notification",
        body: "Weekly dependency scan complete: 1 critical, 3 medium, 9 low findings. Critical finding: outdated TLS library with known CVE in packages/api-gateway.",
      },
    },
  ],
};
