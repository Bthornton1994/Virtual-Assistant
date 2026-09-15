"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_ENGAGEMENT_COOKIE, RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";
import { demoEngagementCookieSecure } from "@/lib/ai-app-release-rescue/demo-cookie";
import { createDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";
import {
  ATTESTATION_FIELDS,
  SCOPE_FACT_FIELDS,
  formDataToRecord,
  parseRescueIntake,
  type RescueIntakeState,
} from "@/lib/ai-app-release-rescue/intake";
import { MAX_INTAKE_FIELD_LENGTH } from "@/lib/ai-app-release-rescue/intake";
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
    // Length before content. This path runs on a FAILED parse, so the values are
    // whatever an anonymous caller posted: unbounded, and previously handed
    // straight to the credential scanner. An oversized field is not echoed at
    // all, which is both cheaper and the right answer for a form re-render.
    if (value.length > MAX_INTAKE_FIELD_LENGTH) continue;
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
  const requestHeaders = await headers();
  jar.set(DEMO_ENGAGEMENT_COOKIE, engagement.id, {
    httpOnly: true,
    sameSite: "lax",
    path: RESCUE_PATH,
    maxAge: 60 * 60 * 24,
    // This cookie is the only thing authorizing the demo engagement page.
    // Secure follows the request protocol; it is never hardcoded false.
    secure: demoEngagementCookieSecure({
      forwardedProto: requestHeaders.get("x-forwarded-proto"),
      vercel: process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV,
    }),
  });
  redirect(`${RESCUE_PATH}/demo/${engagement.id}`);
}
