import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { internalModeEnabled, isLoopbackRequest } from "@/lib/release-rescue-internal/mode";
import { SESSION_COOKIE, operatorFromSession, type LocalOperator } from "@/lib/release-rescue-internal/local-identity";

// The guard every internal page, route and server action runs first.
//
// A request outside the local internal mode, or not addressed to a loopback
// host, gets a 404: the internal workflow does not exist anywhere else, and it
// does not say that it exists.

export const INTERNAL_PATH = "/internal/release-rescue";

export async function requireInternalRequest(): Promise<void> {
  if (!internalModeEnabled()) notFound();
  if (!isLoopbackRequest(await headers())) notFound();
}

/** The signed-in operator, or null. Does not redirect. */
export async function currentOperator(): Promise<LocalOperator | null> {
  await requireInternalRequest();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return operatorFromSession(token);
}

/** The signed-in operator, or a redirect to the login page. */
export async function requireOperator(): Promise<LocalOperator> {
  const operator = await currentOperator();
  if (!operator) redirect(`${INTERNAL_PATH}/login`);
  return operator;
}
