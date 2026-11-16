/**
 * Persona: Project Manager.
 *
 * Proves: escalation deadlines driven by urgency and explicit dates, the
 * clarifying-question path for ambiguous status asks, and a deliberately
 * mis-tuned direction (vendor-noise) that gets overridden often enough for
 * the learning loop to propose narrowing it.
 */

import type { PersonaScenario } from "../types.js";

const START = new Date("2026-10-19T09:00:00.000Z"); // longer window: shows the learning loop firing

export const pmScenario: PersonaScenario = {
  id: "pm",
  displayName: "Project Manager",
  pitch:
    "A PM's inbox is status requests, scheduling, and vendor noise. mind drafts " +
    "status replies for approval rather than inventing numbers, asks the one " +
    "clarifying question a vague request needs, and — because one direction " +
    "was authored too loosely — the override data accumulates until the " +
    "learning loop proposes narrowing it. That proposal is this persona's " +
    "proof that the system gets better at modelling the operator's judgement " +
    "instead of the operator re-writing rules by hand.",
  directionFiles: [
    "demo/pm/scheduling.yaml",
    "demo/pm/vendor-noise.yaml",
    "demo/pm/status-requests.yaml",
  ],
  startAt: START,
  signals: [
    {
      atHour: 0,
      signal: {
        adapter: "demo-email", externalId: "pm-1", threadId: "t-standup",
        sender: "lin@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Can we move tomorrow's standup to 10am instead of 9? I have a 9am with the client.",
      },
      classification: {
        directionId: "demo/pm/scheduling", confidence: 0.85,
        intent: "reschedule a recurring meeting", signalKind: "task", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: true, answerBlocker: null,
      },
      draftBody: "Works for me — moving standup to 10am tomorrow. I'll update the invite.",
      narrative: "Clear request with a stated reason — confirmed and auto-sent, autonomy: send.",
    },
    {
      atHour: 3,
      signal: {
        adapter: "demo-email", externalId: "pm-2", threadId: "t-q4-status",
        sender: "director@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "Need a status update on the Q4 migration for the steering committee by Friday EOD.",
      },
      classification: {
        directionId: "demo/pm/status-requests", confidence: 0.82,
        intent: "status update request with a deadline", signalKind: "task", urgency: "medium",
        commitment: "status update by Friday EOD", escalateBy: "2026-10-23T22:00:00.000Z",
        sensitiveTopics: [], answerable: true, answerBlocker: null,
      },
      draftBody: "Acknowledged — I'll have the Q4 migration status ready for the steering committee by Friday EOD.",
      narrative: "Explicit deadline from the message itself (classifier's escalateBy) overrides the generic urgency table — if Friday passes without a status Thought being closed, the escalation checker promotes it to active.",
    },
    {
      atHour: 5,
      signal: {
        adapter: "demo-email", externalId: "pm-3", threadId: null,
        sender: "vendor-rep@partnerco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Following up on our Q3 contract renewal terms — do you have budget sign-off yet?",
      },
      classification: {
        directionId: "demo/pm/vendor-noise", confidence: 0.55,
        intent: "vendor following up on contract budget", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: ["budget"],
        answerable: false, answerBlocker: "budget sign-off is not the operator's to confirm by email",
      },
      draftBody: "Thanks for following up — I'll get back to you on the budget sign-off status.",
      narrative: "This is exactly the kind of vendor email the vendor-noise direction's author didn't anticipate: it mentions budget, which should escalate, but the direction has no escalateOn guard. Drafted anyway — a human will discard this, which is the point: it generates override evidence.",
    },
    {
      atHour: 26,
      signal: {
        adapter: "demo-email", externalId: "pm-4", threadId: null,
        sender: "vendor-rep2@otherco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Invoice #3381 is 15 days past due — can you confirm payment status?",
      },
      classification: {
        directionId: "demo/pm/vendor-noise", confidence: 0.52,
        intent: "vendor invoice payment inquiry", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: ["budget"],
        answerable: false, answerBlocker: "payment status is a finance question, not the PM's",
      },
      draftBody: "Thanks for the note — checking on invoice #3381 and will confirm payment status shortly.",
      narrative: "Second vendor-noise miss in a row — another discard waiting to happen, building the override count.",
    },
    {
      atHour: 30,
      signal: {
        adapter: "demo-email", externalId: "pm-5", threadId: null,
        sender: "vendor-rep3@thirdco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Can we schedule a call to discuss expanding scope on the integration work?",
      },
      classification: {
        directionId: "demo/pm/vendor-noise", confidence: 0.5,
        intent: "vendor proposing a scope change", signalKind: "task", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: ["scope change"],
        answerable: false, answerBlocker: "scope change needs the PM's explicit judgement, not a form acknowledgement",
      },
      draftBody: "Thanks for reaching out — happy to find time to discuss. I'll follow up with some slots.",
      narrative: "Third vendor-noise miss — a scope-change discussion dressed as routine vendor correspondence. This one would have tripped status-requests' escalateOn guard had it matched that direction instead; it didn't, because vendor-noise's topic scope ('vendor') wins on the sender domain match.",
    },
    {
      atHour: 48,
      signal: {
        adapter: "demo-email", externalId: "pm-6", threadId: "t-ambiguous-status",
        sender: "stakeholder@demo.corp", recipients: ["me@demo.corp"], kind: "message",
        body: "What's the status?",
      },
      classification: {
        directionId: "demo/pm/status-requests", confidence: 0.6,
        intent: "ambiguous status request, no project named", signalKind: "question", urgency: "low",
        commitment: null, escalateBy: null, sensitiveTopics: [],
        answerable: false, answerBlocker: "no project or workstream specified",
      },
      draftBody: "Could you clarify which project or workstream you're asking about? I want to make sure I give you the right update.",
      narrative: "Too vague to answer — the catch-all/status-requests standard asks the single clarifying question rather than guessing which project, and the draft always requires approval (autonomy: draft).",
    },
    {
      atHour: 72,
      signal: {
        adapter: "demo-email", externalId: "pm-7", threadId: null,
        sender: "vendor-rep@partnerco.com", recipients: ["me@demo.corp"], kind: "message",
        body: "Still waiting on the budget sign-off answer from Tuesday — any update?",
      },
      classification: {
        directionId: "demo/pm/vendor-noise", confidence: 0.53,
        intent: "vendor repeat follow-up on budget", signalKind: "question", urgency: "medium",
        commitment: null, escalateBy: null, sensitiveTopics: ["budget"],
        answerable: false, answerBlocker: "budget sign-off, still not the PM's to confirm",
      },
      draftBody: "Apologies for the delay — still confirming on our end, will follow up shortly.",
      narrative: "Fourth vendor-noise miss. With four decided actions on this direction and the operator discarding most of them during replay, the override rate crosses 20% — this is the sample the learning loop reads.",
    },
  ],
};
