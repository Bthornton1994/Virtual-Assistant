import {
  ATTESTATION_FIELDS,
  MAX_INTAKE_FIELD_LENGTH,
  SCOPE_FACT_FIELDS,
} from "@/lib/ai-app-release-rescue/intake";
import { containsLikelySecret } from "@/lib/release-rescue-redaction";

// Fields replayed into the form after a rejection, so the customer does not
// have to retype everything. Each value is re-scanned before it goes back: if a
// customer pasted a token into a text box, the error must not hand it back to
// the page, where it would sit in the DOM and in the browser's history.

export const ECHO_FIELDS = [
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

export function echoSafeFields(formData: FormData): Record<string, string> {
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
