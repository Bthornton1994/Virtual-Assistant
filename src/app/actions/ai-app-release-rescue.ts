"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEMO_ENGAGEMENT_COOKIE,
  DEMO_ENGAGEMENT_TTL_SECONDS,
  RESCUE_PATH,
} from "@/lib/ai-app-release-rescue/constants";
import { demoEngagementCookieSecure } from "@/lib/ai-app-release-rescue/demo-cookie";
import { createDemoEngagement } from "@/lib/ai-app-release-rescue/engagement";
import { echoSafeFields } from "@/lib/ai-app-release-rescue/echo-safe-fields";
import { formDataToRecord, parseRescueIntake, type RescueIntakeState } from "@/lib/ai-app-release-rescue/intake";

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
    // The same lifetime as the record itself, so neither outlives the other.
    maxAge: DEMO_ENGAGEMENT_TTL_SECONDS,
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
