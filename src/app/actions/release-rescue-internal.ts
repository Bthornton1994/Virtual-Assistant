"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RETENTION_POLICIES, type RetentionPolicy } from "@/lib/release-rescue-intake";
import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  authenticateOperator,
  issueSession,
} from "@/lib/release-rescue-internal/local-identity";
import { INTERNAL_PATH, requireInternalRequest, requireOperator } from "@/lib/release-rescue-internal/request-guard";
import { signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { RunRefused, initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import { isRunId } from "@/lib/release-rescue-internal/store";

// Server actions for the internal, local-only Release Rescue workflow. Each one
// runs the request guard first, so none of them exists outside local internal
// mode on a loopback host.

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function loginInternalOperatorAction(formData: FormData): Promise<void> {
  await requireInternalRequest();
  const result = authenticateOperator(text(formData, "displayName"), text(formData, "passphrase"));
  if (!result.ok) redirect(`${INTERNAL_PATH}/login?error=${result.reason}`);
  (await cookies()).set(SESSION_COOKIE, issueSession(result.operator.operatorId), {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: INTERNAL_PATH,
    maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
  });
  redirect(INTERNAL_PATH);
}

export async function logoutInternalOperatorAction(): Promise<void> {
  await requireInternalRequest();
  (await cookies()).delete({ name: SESSION_COOKIE, path: INTERNAL_PATH });
  redirect(`${INTERNAL_PATH}/login`);
}

export async function startInternalRunAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const retention = text(formData, "retentionPolicy");
  const commitSha = text(formData, "commitSha").trim().toLowerCase();
  let runId: string;
  try {
    const record = await startInternalRun({
      initiatedBy: initiatorFromOperator(operator),
      repositoryRef: text(formData, "repositoryRef"),
      commitSha,
      retentionPolicy: ((RETENTION_POLICIES as readonly string[]).includes(retention)
        ? retention
        : "unknown") as RetentionPolicy,
      ownershipConfirmed: text(formData, "ownershipConfirmed") === "yes",
      source: { kind: "checkout" },
    });
    runId = record.runId;
  } catch (error) {
    if (error instanceof RunRefused) redirect(`${INTERNAL_PATH}?refused=${error.reason}`);
    throw error;
  }
  redirect(`${INTERNAL_PATH}/runs/${runId}`);
}

export async function signInternalRunAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const runId = text(formData, "runId");
  if (!isRunId(runId)) redirect(INTERNAL_PATH);
  // Exactly the two fields a reviewer may send. Anything else a client adds is
  // not forwarded, and the identity comes from the session.
  const outcome = signRunAsLocalOperator(operator, runId, {
    reasonCode: text(formData, "reasonCode"),
    approvedContentHash: text(formData, "approvedContentHash"),
  });
  if (!outcome.ok) redirect(`${INTERNAL_PATH}/runs/${runId}?refused=${outcome.reason}`);
  redirect(`${INTERNAL_PATH}/runs/${runId}?signed=1`);
}
