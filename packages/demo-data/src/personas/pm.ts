/**
 * Persona: Project Manager.
 *
 * Fake signals, real decisions. The vendor-noise direction is deliberately
 * authored too loosely (low confidenceMin, no escalateOn for budget/scope
 * topics) so that whatever the model actually drafts for those vendor
 * emails, the simulated operator reaction is likely to discard a good share
 * of them — building real override history for the learning loop to react to.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-19T09:00:00.000Z");

export const pmScenario: PersonaScenario = {
  id: "pm",
  displayName: "Project Manager",
  pitch:
    "A PM's inbox is status requests, scheduling, and vendor noise. Whether " +
    "a draft gets approved or discarded depends on what the model actually " +
    "writes against each direction's standard — a deliberately loose " +
    "direction (vendor-noise) is expected to accumulate overrides and " +
    "eventually trigger a real learning-loop proposal to narrow it.",
  directionFiles: [
    "demo/pm/scheduling.yaml",
    "demo/pm/vendor-noise.yaml",
    "demo/pm/status-requests.yaml",
  ],
  startAt: START,
  signals: [
    {
      atHour: 0,
      era: "historical",
      intent: "clear scheduling request with a stated reason",
      signal: {
        adapter: "demo-email", externalId: "pm-1", threadId: "t-standup",
        sender: "lin@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Can we move tomorrow's standup to 10am instead of 9? I have a 9am with the client.",
      },
    },
    {
      atHour: 3,
      era: "historical",
      intent: "status request with an explicit deadline",
      signal: {
        adapter: "demo-email", externalId: "pm-2", threadId: "t-q4-status",
        sender: "director@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Need a status update on the Q4 migration for the steering committee by Friday EOD.",
      },
    },
    {
      atHour: 5,
      era: "historical",
      intent: "vendor email touching budget — vendor-noise direction has no guard for this",
      signal: {
        adapter: "demo-email", externalId: "pm-3", threadId: null,
        sender: "vendor-rep@partnerco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Following up on our Q3 contract renewal terms — do you have budget sign-off yet?",
      },
    },
    {
      atHour: 26,
      era: "historical",
      intent: "vendor invoice/payment inquiry",
      signal: {
        adapter: "demo-email", externalId: "pm-4", threadId: null,
        sender: "vendor-rep2@otherco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Invoice #3381 is 15 days past due — can you confirm payment status?",
      },
    },
    {
      atHour: 30,
      era: "historical",
      intent: "vendor proposing a scope change, dressed as routine correspondence",
      signal: {
        adapter: "demo-email", externalId: "pm-5", threadId: null,
        sender: "vendor-rep3@thirdco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Can we schedule a call to discuss expanding scope on the integration work?",
      },
    },
    {
      atHour: 48,
      era: "historical",
      intent: "ambiguous status request, no project named",
      signal: {
        adapter: "demo-email", externalId: "pm-6", threadId: "t-ambiguous-status",
        sender: "stakeholder@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "What's the status?",
      },
    },
    {
      atHour: 72,
      era: "historical",
      intent: "repeat vendor follow-up on budget",
      signal: {
        adapter: "demo-email", externalId: "pm-7", threadId: null,
        sender: "vendor-rep@partnerco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Still waiting on the budget sign-off answer from Tuesday — any update?",
      },
    },
    // ── live era — left unresolved for the operator to act on ──────────────
    {
      atHour: 0,
      era: "live",
      intent: "fresh status request in a new thread",
      signal: {
        adapter: "demo-email", externalId: "pm-8", threadId: "t-release-status",
        sender: "director@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "What's the latest on the release timeline for next sprint? Steering committee is asking.",
      },
    },
    {
      atHour: 0,
      era: "live",
      intent: "another vendor email on the loosely-authored direction",
      signal: {
        adapter: "demo-email", externalId: "pm-9", threadId: null,
        sender: "vendor-rep4@fourthco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "We'd like to discuss a change in payment terms for the current contract — can we set up a call?",
      },
    },
  ],
};
