export const WORKSTREAM_RUN_STATUSES = [
  "planned",
  "running",
  "awaiting_verification",
  "verified",
  "failed",
  "cancelled",
] as const;

export type WorkstreamRunStatus = (typeof WORKSTREAM_RUN_STATUSES)[number];

export const WORKSTREAM_RUN_TRANSITIONS: Record<WorkstreamRunStatus, WorkstreamRunStatus[]> = {
  planned: ["running", "cancelled"],
  running: ["awaiting_verification", "failed", "cancelled"],
  awaiting_verification: ["verified", "failed"],
  verified: [],
  failed: [],
  cancelled: [],
};

export function canTransitionWorkstreamRun(from: WorkstreamRunStatus, to: WorkstreamRunStatus) {
  return WORKSTREAM_RUN_TRANSITIONS[from].includes(to);
}

export function finalRunStatusForReceipt(
  verificationStatus: "passed" | "failed",
  definitionOfDoneMet: boolean,
): Extract<WorkstreamRunStatus, "verified" | "failed"> {
  return verificationStatus === "passed" && definitionOfDoneMet ? "verified" : "failed";
}

export function requiresEvidence(verificationRules: string[]) {
  return verificationRules.some((rule) => rule.trim().length > 0);
}
