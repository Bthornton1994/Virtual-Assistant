export type AuditAnswers = {
  teamSize: number;
  role: string;
  industry: string;
  companySize: string;
  softwareStack: string[];
  weeklyHours: number;
  inboxBurden: number;
  meetingBurden: number;
  salesAdministration: number;
  crmUsage: number;
  researchWorkload: number;
  reportingWorkload: number;
  customerOnboarding: number;
  billingAdministration: number;
  contentAdministration: number;
  postponedTasks: string;
};

export type AuditOpportunity = {
  name: string;
  burden: "High" | "Moderate" | "Low";
  potential: number;
  system: string;
};

export type AuditResult = {
  score: number;
  readiness: "LOW" | "MODERATE" | "HIGH";
  workflowCount: number;
  opportunities: AuditOpportunity[];
  delegatableHoursEstimate: number;
  recommendedWorkstreams: string[];
  automationCandidates: string[];
  aiAssistedCandidates: string[];
  humanOperatedCandidates: string[];
  notes: string[];
};

const BURDEN_TO_WORKSTREAM: Array<{
  key: keyof AuditAnswers;
  label: string;
  workstream: string;
  automation?: string;
  ai?: string;
  human?: string;
}> = [
  {
    key: "inboxBurden",
    label: "Inbox",
    workstream: "Executive Operations",
    automation: "Labeling and filing rules",
    ai: "Draft replies and triage buckets",
    human: "Relationship-sensitive replies",
  },
  {
    key: "meetingBurden",
    label: "Meetings",
    workstream: "Executive Operations",
    automation: "Scheduling links and reminders",
    ai: "Agenda and notes drafts",
    human: "Decision capture and owner assignment",
  },
  {
    key: "salesAdministration",
    label: "Sales Follow-Up",
    workstream: "Sales Operations",
    automation: "Stage hygiene reminders",
    ai: "Proposal assembly from approved language",
    human: "Pricing exceptions and customer commitments",
  },
  {
    key: "crmUsage",
    label: "CRM",
    workstream: "Sales Operations",
    automation: "Field completeness checks",
    ai: "Activity summaries",
    human: "Account strategy",
  },
  {
    key: "researchWorkload",
    label: "Research",
    workstream: "Executive Operations",
    automation: "Source collection jobs",
    ai: "Sourced briefing drafts",
    human: "Recommendation quality",
  },
  {
    key: "reportingWorkload",
    label: "Reporting",
    workstream: "Back Office Operations",
    automation: "Weekly report compilation",
    ai: "Narrative highlights",
    human: "Interpretation for the board or founder",
  },
  {
    key: "customerOnboarding",
    label: "Client Onboarding",
    workstream: "Customer Operations",
    automation: "Checklist progression",
    ai: "Kickoff pack drafts",
    human: "Exception handling and relationship risk",
  },
  {
    key: "billingAdministration",
    label: "Billing",
    workstream: "Back Office Operations",
    automation: "Invoice generation from approved rates",
    ai: "Collections draft notes",
    human: "Payment exceptions and terms",
  },
  {
    key: "contentAdministration",
    label: "Content",
    workstream: "Content Operations",
    automation: "Editorial calendar reminders",
    ai: "First drafts from an approved POV",
    human: "Voice, claims, and publish approval",
  },
];

export function scoreDelegationAudit(answers: AuditAnswers): AuditResult {
  const burdens = BURDEN_TO_WORKSTREAM.map((row) => ({
    ...row,
    value: Number(answers[row.key]) || 0,
  }));
  const burdenSum = burdens.reduce((s, b) => s + b.value, 0);
  const maxBurden = burdens.length * 5;
  const hourPressure = Math.min(answers.weeklyHours / 60, 1);
  const teamPressure = Math.min(answers.teamSize / 25, 1);
  const postponedBoost = answers.postponedTasks.trim() ? 8 : 0;

  const score = Math.round(
    Math.min(
      100,
      (burdenSum / maxBurden) * 62 + hourPressure * 18 + teamPressure * 12 + postponedBoost,
    ),
  );

  const hoursFromBurden = burdens.reduce((s, b) => s + b.value * 0.7, 0);
  const hoursFromWeek = Math.max(0, answers.weeklyHours - 40) * 0.35;
  const delegatableHoursEstimate = Math.round((hoursFromBurden + hoursFromWeek) * 10) / 10;

  const ranked = [...burdens].sort((a, b) => b.value - a.value);
  const recommendedWorkstreams = [
    ...new Set(["Executive Operations", ...ranked.filter((b) => b.value >= 3).map((b) => b.workstream)]),
  ].slice(0, 5);

  const automationCandidates = ranked
    .filter((b) => b.value >= 3 && b.automation)
    .map((b) => b.automation!)
    .slice(0, 4);
  const aiAssistedCandidates = ranked
    .filter((b) => b.value >= 3 && b.ai)
    .map((b) => b.ai!)
    .slice(0, 4);
  const humanOperatedCandidates = ranked
    .filter((b) => b.value >= 2 && b.human)
    .map((b) => b.human!)
    .slice(0, 4);

  const opportunities: AuditOpportunity[] = ranked
    .filter((b) => b.value > 0)
    .map((b) => ({
      name: b.label,
      burden: b.value >= 4 ? "High" : b.value >= 3 ? "Moderate" : "Low",
      potential: Math.min(95, 55 + b.value * 8),
      system: b.workstream,
    }));

  const readiness: AuditResult["readiness"] = score >= 70 ? "HIGH" : score >= 40 ? "MODERATE" : "LOW";

  return {
    score,
    readiness,
    workflowCount: Math.max(opportunities.filter((o) => o.burden !== "Low").length, opportunities.length ? 1 : 0),
    opportunities,
    delegatableHoursEstimate,
    recommendedWorkstreams,
    automationCandidates,
    aiAssistedCandidates,
    humanOperatedCandidates,
    notes: [
      "All workload figures are estimates, not a time-and-motion study.",
      "Readiness is scored from the categories you marked, how often they interrupt you, hours in the week, and postponed work. It is not a measured time study.",
      "Sensitive billing, access, and external commitments still require explicit approval.",
    ],
  };
}
