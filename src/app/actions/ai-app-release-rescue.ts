"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_ENGAGEMENT_COOKIE, RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";
import { createDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";
import {
  ATTESTATION_FIELDS,
  SCOPE_FACT_FIELDS,
  formDataToRecord,
  parseRescueIntake,
  type RescueIntakeState,
} from "@/lib/ai-app-release-rescue/intake";
import { containsLikelySecret } from "@/lib/release-rescue-redaction";

// Fields replayed into the form after a rejection, so the customer does not
// have to retype everything. Each value is re-scanned before it goes back: if a
// customer pasted a token into a text box, the error must not hand it back to
// the page, where it would sit in the DOM and in the browser's history.
const ECHO_FIELDS = [
  "contactName",
  "workEmail",
  "repositoryUrl",
  "repositoryHost",
  "applicationName",
  "defaultBranch",
  "appType",
  "criticalWorkflow",
  "criticalWorkflowEntryPoint",
  "accessGrantMethod",
  "accessWindowDays",
  "retentionPolicy",
  "evidenceNotes",
  "evidenceFileNames",
  "remediationInterest",
  ...SCOPE_FACT_FIELDS,
  ...ATTESTATION_FIELDS,
] as const;

function echoSafeFields(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHO_FIELDS as readonly string[]) {
    const value = formData.get(key);
    if (typeof value !== "string") continue;
    // A value that looks like a credential is dropped rather than replayed, so
    // the token never returns to the page it arrived from.
    if (containsLikelySecret(value)) continue;
    values[key] = value;
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
    // Secure everywhere except local http development. This cookie is the only
    // thing authorizing the demo engagement page.
    secure: process.env.NODE_ENV === "production",
  });
  redirect(`${RESCUE_PATH}/demo/${engagement.id}`);
}
