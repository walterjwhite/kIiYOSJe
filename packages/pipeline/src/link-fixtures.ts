/**
 * Synthetic evaluation set for goal linking. Every name, address and message is
 * invented. 30 goals, so the old behaviour (first 25 goals in the prompt) cannot
 * even see the last five.
 */
import type { GoalDoc } from "./link-candidates.js";

const goal = (
  id: string,
  title: string,
  body = "",
  parentTitle: string | null = null,
): GoalDoc => ({
  id,
  title,
  body,
  parentTitle,
});

export const FIXTURE_GOALS: readonly GoalDoc[] = [
  goal("g01", "Ship the Q4 financial report", "Quarterly numbers for the board"),
  goal("g02", "Hire a product designer", "Interviews and offer for the design role"),
  goal("g03", "Migrate billing to the new payment provider"),
  goal("g04", "Plan the offsite in Lisbon", "Venue, flights, agenda for the team retreat"),
  goal("g05", "Renew office lease", "Landlord negotiation, lease term and rent"),
  goal("g06", "Kitchen renovation", "Contractor quotes, cabinets and tile"),
  goal("g07", "Tax filing 2026", "Accountant, receipts and deductions"),
  goal("g08", "Launch the mobile app beta", "TestFlight invitations and crash reports"),
  goal("g09", "Write the conference talk", "Slides and abstract for the autumn conference"),
  goal("g10", "Switch health insurance", "Compare plans and enrollment deadline"),
  goal("g11", "Fix flaky CI pipeline", "Intermittent test failures on the build server"),
  goal("g12", "Vendor security review", "Questionnaire and penetration test report"),
  goal("g13", "Pet adoption", "Shelter visit and vaccination records"),
  goal("g14", "Learn Portuguese", "Weekly tutor sessions and vocabulary"),
  goal("g15", "Marathon training", "Long runs, race registration and physio"),
  goal("g16", "Customer onboarding revamp", "Welcome emails and activation checklist"),
  goal("g17", "Annual performance reviews", "Self assessments and calibration meeting"),
  goal("g18", "Domain and DNS cleanup", "Expired domains and registrar transfer"),
  goal("g19", "Open source maintainer duties", "Issues, pull requests and release notes"),
  goal("g20", "Car insurance and service", "Garage appointment and policy renewal"),
  goal("g21", "Update the pricing page", "New tiers and annual discount copy"),
  goal("g22", "Board meeting preparation", "Agenda, deck and pre-reads"),
  goal("g23", "Wedding gift registry", "Guest list and present ideas"),
  goal("g24", "Data warehouse cost reduction", "Query spend and storage tiers"),
  goal("g25", "Podcast guest booking", "Scheduling recordings with interviewees"),
  // Beyond the old 25-goal prompt limit:
  goal("g26", "Passport renewal", "Appointment at the consulate and photo requirements"),
  goal("g27", "GDPR data deletion requests", "Subject access requests and retention policy"),
  goal("g28", "Newsletter redesign", "Template, subscriber segments and send schedule"),
  goal("g29", "Sublet the spare room", "Tenant screening and rental agreement"),
  goal("g30", "Review", "Check the draft", "Ship the Q4 financial report"),
];

export interface FixtureSignal {
  readonly sender: string;
  readonly subject: string;
  readonly body: string;
  /** The goal a person would link it to, or null when none fits. */
  readonly expected: string | null;
}

export const FIXTURE_SIGNALS: readonly FixtureSignal[] = [
  {
    sender: "cfo@example.com",
    subject: "Q4 report numbers",
    body: "Can you send the final quarterly financial figures for the board report by Friday?",
    expected: "g01",
  },
  {
    sender: "recruiter@example.org",
    subject: "Designer candidate",
    body: "The product designer candidate finished the final interview and we should prepare an offer.",
    expected: "g02",
  },
  {
    sender: "billing@example.net",
    subject: "Payment provider cutover",
    body: "The new payment provider needs your approval before we migrate the billing system.",
    expected: "g03",
  },
  {
    sender: "venue@example.com",
    subject: "Lisbon offsite booking",
    body: "We can confirm the venue in Lisbon for the team retreat. Please send the flight dates and agenda.",
    expected: "g04",
  },
  {
    sender: "landlord@example.org",
    subject: "Lease renewal terms",
    body: "Here is the proposed rent and lease term for the office lease renewal.",
    expected: "g05",
  },
  {
    sender: "builder@example.net",
    subject: "Cabinet and tile quote",
    body: "Attached is the contractor quote for kitchen cabinets and tile work.",
    expected: "g06",
  },
  {
    sender: "accountant@example.com",
    subject: "Missing receipts",
    body: "For the tax filing I still need your receipts and deductions for the year.",
    expected: "g07",
  },
  {
    sender: "beta@example.org",
    subject: "TestFlight crash",
    body: "Several beta testers report a crash in the mobile app after installing from TestFlight.",
    expected: "g08",
  },
  {
    sender: "chair@example.com",
    subject: "Talk abstract deadline",
    body: "The conference needs your slides and talk abstract by next week.",
    expected: "g09",
  },
  {
    sender: "hr@example.net",
    subject: "Enrollment closes",
    body: "Health insurance enrollment closes soon; compare the plans and choose.",
    expected: "g10",
  },
  {
    sender: "bot@example.org",
    subject: "Build failed again",
    body: "The CI pipeline failed with an intermittent test failure on the build server.",
    expected: "g11",
  },
  {
    sender: "sec@example.com",
    subject: "Security questionnaire",
    body: "Please complete the vendor security questionnaire and attach the penetration test report.",
    expected: "g12",
  },
  {
    sender: "ops@example.net",
    subject: "Expired domain",
    body: "Two domains expired and the registrar transfer needs your DNS records.",
    expected: "g18",
  },
  {
    sender: "ci@example.org",
    subject: "Release notes",
    body: "A pull request is waiting for review and the release notes need an update for the maintainers.",
    expected: "g19",
  },
  {
    sender: "garage@example.com",
    subject: "Service appointment",
    body: "Your car service appointment is booked and the insurance policy renewal is attached.",
    expected: "g20",
  },
  {
    sender: "consulate@example.org",
    subject: "Passport appointment",
    body: "Your passport renewal appointment is confirmed. Bring the photo that meets the requirements.",
    expected: "g26",
  },
  {
    sender: "privacy@example.net",
    subject: "Deletion request",
    body: "A customer filed a GDPR data deletion request and asks about the retention policy.",
    expected: "g27",
  },
  {
    sender: "marketing@example.com",
    subject: "Newsletter template",
    body: "The newsletter redesign needs a decision on the template and subscriber segments.",
    expected: "g28",
  },
  {
    sender: "tenant@example.org",
    subject: "Room viewing",
    body: "I would like to see the spare room you want to sublet and read the rental agreement.",
    expected: "g29",
  },
  {
    sender: "friend@example.net",
    subject: "Dinner on Saturday?",
    body: "Are you free for dinner on Saturday? Let me know what you fancy.",
    expected: null,
  },
  {
    sender: "promo@example.com",
    subject: "Weekend sale",
    body: "Everything is half price this weekend only.",
    expected: null,
  },
];
