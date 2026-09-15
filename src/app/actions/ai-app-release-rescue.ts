"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_ENGAGEMENT_COOKIE, RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";
import { createDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";
import {
  formDataToRecord,
  parseRescueIntake,
  type RescueIntakeState,
} from "@/lib/ai-app-release-rescue/intake";

const ECHO_FIELDS = [
  "contactName",
  "workEmail",
  "repositoryUrl",
  "appType",
  "criticalWorkflow",
  "deploymentUrl",
  "accessGrantMethod",
  "evidenceNotes",
  "evidenceFileNames",
  "aiAssistedOptIn",
  "remediationInterest",
  "acknowledgedNotPenTest",
  "acknowledgedNotCompliance",
  "acknowledgedNoGuarantee",
  "acknowledgedSingleScope",
  "acknowledgedPointInTime",
  "acknowledgedNoSecretsSubmitted",
] as const;

function echoSafeFields(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHO_FIELDS) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function submitRescueIntakeAction(
  _prev: RescueIntakeState,
  formData: FormData,
): Promise<RescueIntakeState> {
  const parsed = parseRescueIntake(formDataToRecord(formData));
  if (!parsed.ok) {
    return {
      errors: parsed.errors,
      formError: parsed.formError ?? "Check the highlighted fields. Nothing was stored.",
      values: echoSafeFields(formData),
    };
  }

  const engagement = createDemoEngagement(parsed.intake);
  const jar = await cookies();
  jar.set(DEMO_ENGAGEMENT_COOKIE, engagement.id, {
    httpOnly: true,
    sameSite: "lax",
    path: RESCUE_PATH,
    maxAge: 60 * 60 * 24,
    secure: false,
  });
  redirect(`${RESCUE_PATH}/demo/${engagement.id}`);
}
