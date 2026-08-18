export type SolutionSlug =
  | "executive-operations"
  | "sales-operations"
  | "customer-operations"
  | "business-operations"
  | "content-operations";

export type SolutionCategory = {
  slug: SolutionSlug;
  catalogKey: "day" | "revenue" | "customers" | "business" | "presence";
  catalogLabel: string;
  catalogHint: string;
  name: string;
  problem: string;
  outcome: string;
  owns: string[];
  exampleRequests: string[];
  workflow: string[];
  customerApproves: string[];
  integrations: string[];
  deliverables: string[];
  metrics: string[];
  items: string[];
};

export const SOLUTIONS: SolutionCategory[] = [
  {
    slug: "executive-operations",
    catalogKey: "day",
    catalogLabel: "Run my day",
    catalogHint: "Inbox, calendar, meetings, travel, research, follow-up",
    name: "Run my day",
    problem:
      "Your morning is already spoken for before the work that actually requires you begins. Mail, calendar, prep, and follow-up sit in the same queue as judgment.",
    outcome: "You open the day to decisions, not a pile of coordination.",
    owns: [
      "Inbox triage and draft replies (not sent unless you approve)",
      "Calendar and rescheduling",
      "Meeting agendas, notes, and action capture",
      "Travel logistics",
      "Research briefs from public sources",
      "Follow-up chase lists",
    ],
    exampleRequests: [
      "Triage my inbox so only decisions reach me.",
      "Prepare me for tomorrow’s four meetings.",
      "Research five venues for the offsite.",
    ],
    workflow: [
      "Collect the day’s mail, calendar, and open threads",
      "Triage into decide / draft / file",
      "Build agendas and briefs",
      "Return a morning pack and a chase list",
    ],
    customerApproves: ["Anything sent outside the company", "Calendar holds that affect other people"],
    integrations: ["Google Workspace", "Microsoft 365", "Zoom"],
    deliverables: ["Morning brief", "Draft reply pack", "Agenda and notes"],
    metrics: ["Hours returned (estimate from completed work)", "Briefs on time", "Open decisions waiting on you"],
    items: ["Inbox", "Calendar", "Meetings", "Travel", "Research", "Follow-up"],
  },
  {
    slug: "sales-operations",
    catalogKey: "revenue",
    catalogLabel: "Grow revenue",
    catalogHint: "Lead research, CRM, pipeline, proposals, sales coordination",
    name: "Grow revenue",
    problem:
      "The pipeline only stays honest if someone lives in the CRM. That someone is usually you, after hours.",
    outcome: "Every open opportunity has an owner, a next step, and a record you can trust.",
    owns: [
      "Lead and account research",
      "CRM hygiene",
      "Pipeline administration",
      "Proposal assembly from approved language",
      "Follow-up sequences you have authorized",
    ],
    exampleRequests: [
      "Clean up HubSpot and make sure every open lead has a next step.",
      "Assemble the Meridian proposal from the rate card. Do not send it.",
      "Follow up every conference lead from last week.",
    ],
    workflow: [
      "Audit open opportunities",
      "Find missing owner, stage, contact, or next activity",
      "Research what can be found",
      "Flag what only you can decide",
      "Update approved records and hand you the exceptions",
    ],
    customerApproves: ["Pricing and scope language", "Outbound to a buying champion"],
    integrations: ["HubSpot", "Salesforce", "Google Workspace"],
    deliverables: ["Pipeline hygiene summary", "Proposal draft", "Follow-up pack"],
    metrics: ["Stale deals", "Opportunities missing a next step", "Proposal cycle time"],
    items: ["Lead research", "CRM", "Pipeline administration", "Proposals", "Sales coordination"],
  },
  {
    slug: "customer-operations",
    catalogKey: "customers",
    catalogLabel: "Serve customers",
    catalogHint: "Onboarding, check-ins, support, renewals, feedback",
    name: "Serve customers",
    problem:
      "Onboarding, check-ins, and renewals slip because they are important but not urgent — until they are.",
    outcome: "Customers are onboarded, checked on, and prepared for renewal without you holding the checklist.",
    owns: [
      "Onboarding checklists and kickoff packs",
      "Account check-in prep",
      "Support coordination",
      "Renewal readiness packs",
      "Feedback collection workflows",
    ],
    exampleRequests: [
      "Run the onboarding checklist for Helio Analytics.",
      "Prepare a 14-day health review for the three at-risk accounts.",
      "Get the renewal pack ready 14 days out.",
    ],
    workflow: [
      "Open the playbook for that account type",
      "Assemble the pack from source files",
      "Chase missing inputs",
      "Surface relationship risk to you",
      "Deliver the next checkpoint",
    ],
    customerApproves: ["Anything promised to the customer", "Exceptions to the standard path"],
    integrations: ["HubSpot", "Slack", "Google Workspace"],
    deliverables: ["Onboarding pack", "Health review", "Renewal brief"],
    metrics: ["Time to onboard", "At-risk accounts", "Renewal readiness"],
    items: ["Onboarding", "Account check-ins", "Support coordination", "Renewals", "Feedback workflows"],
  },
  {
    slug: "business-operations",
    catalogKey: "business",
    catalogLabel: "Run the business",
    catalogHint: "Reporting, vendors, invoices, documents, recurring admin",
    name: "Run the business",
    problem:
      "Invoices, vendors, and the Friday pack do not fail loudly. They fail by becoming your Sunday.",
    outcome: "The operating rhythm happens on schedule. You review exceptions, not the whole pile.",
    owns: [
      "Weekly operating reports",
      "Vendor follow-up",
      "Invoice preparation from approved rates",
      "Document assembly",
      "Recurring administration",
    ],
    exampleRequests: [
      "Follow up on every overdue invoice.",
      "Build Friday’s operating report.",
      "Prepare the vendor retainer pack. Do not pay anyone.",
    ],
    workflow: [
      "Pull the source numbers and invoices",
      "Assemble the pack",
      "Flag anything that needs your authority",
      "Deliver the report or chase list",
    ],
    customerApproves: ["Payments, terms, and anything that moves money", "External collections language"],
    integrations: ["QuickBooks", "Google Workspace", "HubSpot"],
    deliverables: ["Weekly report", "Invoice pack", "Vendor chase list"],
    metrics: ["Close on time", "Aging invoices", "Report punctuality"],
    items: ["Reporting", "Vendors", "Invoices", "Documents", "Recurring administration"],
  },
  {
    slug: "content-operations",
    catalogKey: "presence",
    catalogLabel: "Build my presence",
    catalogHint: "Research, drafts, repurposing, scheduling, publish coordination",
    name: "Build my presence",
    problem:
      "The point of view is already in your head. Turning it into drafts and a queue is what never makes the week.",
    outcome: "Approved thinking becomes a publish-ready queue. Nothing goes out without you.",
    owns: [
      "Content research",
      "First drafts from an approved point of view",
      "Repurposing across formats",
      "Calendar and scheduling",
      "Publishing coordination after approval",
    ],
    exampleRequests: [
      "Draft a point of view on managed delegation vs. hiring. Do not publish.",
      "Turn last month’s talk into three posts.",
      "Keep the editorial calendar current.",
    ],
    workflow: [
      "Collect the source POV",
      "Draft",
      "Package assets",
      "Hold for your approval",
      "Coordinate publish only after you say so",
    ],
    customerApproves: ["Claims, voice, and anything that will be published"],
    integrations: ["Google Workspace", "Notion", "LinkedIn (after approval)"],
    deliverables: ["Draft", "Repurposed assets", "Editorial queue"],
    metrics: ["Drafts delivered", "Revision cycles", "Publish-ready queue"],
    items: ["Content research", "Drafts", "Repurposing", "Scheduling", "Publishing coordination"],
  },
];

export function solutionBySlug(slug: string) {
  return SOLUTIONS.find((s) => s.slug === slug) ?? null;
}

export const DEMO_PLANS: Record<
  string,
  { title: string; system: string; objective: string; steps: string[]; input: string }
> = {
  default: {
    title: "Sales follow-up",
    system: "Grow revenue",
    objective: "Every active opportunity has accurate data and a documented next action.",
    steps: [
      "Inspect open opportunities",
      "Identify missing owner, stage, contact, or next activity",
      "Research missing information",
      "Flag ambiguous opportunities",
      "Update approved records",
      "Create follow-up tasks",
      "Deliver a pipeline hygiene summary",
    ],
    input: "~10 minutes to review the records only you can judge.",
  },
};

export function planForPrompt(prompt: string) {
  const t = prompt.toLowerCase();
  if (t.includes("meeting") || t.includes("prepare")) {
    return {
      title: "Meeting prep",
      system: "Run my day",
      objective: "You walk into each meeting with the brief, the open questions, and the last decisions.",
      steps: [
        "Pull attendees and last notes",
        "Assemble a one-page brief per meeting",
        "List open questions",
        "Flag anything that needs your judgment",
        "Deliver the afternoon pack",
      ],
      input: "Confirm which meetings are still on, and any private context we should not pull.",
    };
  }
  if (t.includes("invoice") || t.includes("overdue")) {
    return {
      title: "Collections chase",
      system: "Run the business",
      objective: "Every overdue invoice has a documented next action. No payment is initiated.",
      steps: [
        "List overdue invoices",
        "Match each to the last contact",
        "Draft chase notes",
        "Flag disputes",
        "Deliver the chase pack for your approval before anything is sent",
      ],
      input: "Approve the language before any customer is contacted.",
    };
  }
  if (t.includes("vendor") || t.includes("research")) {
    return {
      title: "Vendor research",
      system: "Run my day",
      objective: "A sourced shortlist you can decide from, without starting from a blank page.",
      steps: [
        "Clarify the criteria from your request",
        "Collect public sources",
        "Compare five options",
        "Note uncertainty",
        "Deliver the brief",
      ],
      input: "Any hard constraints (budget, city, dates) we should treat as fixed.",
    };
  }
  if (t.includes("hubspot") || t.includes("crm") || t.includes("lead")) {
    return DEMO_PLANS.default;
  }
  return {
    ...DEMO_PLANS.default,
    title: prompt.slice(0, 72) || DEMO_PLANS.default.title,
  };
}
