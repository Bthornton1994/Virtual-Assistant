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

export type AuditResult = {
  score: number;
  delegatableHoursEstimate: number;
  recommendedWorkstreams: string[];
  automationCandidates: string[];
  aiAssistedCandidates: string[];
  humanOperatedCandidates: string[];
  notes: string[];
};

const BURDEN_TO_WORKSTREAM: Array<{
  key: keyof AuditAnswers;
  workstream: string;
  automation?: string;
  ai?: string;
  human?: string;
}> = [
  {
    key: "inboxBurden",
    workstream: "Inbox Operations",
    automation: "Labeling and filing rules",
    ai: "Draft replies and triage buckets",
    human: "Relationship-sensitive replies",
  },
  {
    key: "meetingBurden",
    workstream: "Meeting Operations",
    automation: "Scheduling links and reminders",
    ai: "Agenda and notes drafts",
    human: "Decision capture and owner assignment",
  },
  {
    key: "salesAdministration",
    workstream: "Sales Operations",
    automation: "Stage hygiene reminders",
    ai: "Proposal assembly from approved language",
    human: "Pricing exceptions and customer commitments",
  },
  {
    key: "crmUsage",
    workstream: "Sales Operations",
    automation: "Field completeness checks",
    ai: "Activity summaries",
    human: "Account strategy",
  },
  {
    key: "researchWorkload",
    workstream: "Research Desk",
    automation: "Source collection jobs",
    ai: "Sourced briefing drafts",
    human: "Recommendation quality",
  },
  {
    key: "reportingWorkload",
    workstream: "Back Office Operations",
    automation: "Weekly report compilation",
    ai: "Narrative highlights",
    human: "Interpretation for the board or founder",
  },
  {
    key: "customerOnboarding",
    workstream: "Customer Operations",
    automation: "Checklist progression",
    ai: "Kickoff pack drafts",
    human: "Exception handling and relationship risk",
  },
  {
    key: "billingAdministration",
    workstream: "Back Office Operations",
    automation: "Invoice generation from approved rates",
    ai: "Collections draft notes",
    human: "Payment exceptions and terms",
  },
  {
    key: "contentAdministration",
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

  return {
    score,
    delegatableHoursEstimate,
    recommendedWorkstreams,
    automationCandidates,
    aiAssistedCandidates,
    humanOperatedCandidates,
    notes: [
      "All workload figures are estimates, not a time-and-motion study.",
      "High scores mean more of the week is coordinative work that a managed team can absorb.",
      "Sensitive billing, access, and external commitments still require explicit approval.",
    ],
  };
}
