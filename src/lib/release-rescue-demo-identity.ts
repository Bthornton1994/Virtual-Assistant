// The identifiers the demo report is built from.
//
// These are here, in a leaf module with no imports, for one reason: the field
// policy has to name them.
//
// Every identifier a real report carries is a UUID, because that is what the
// columns are — `organization_id uuid`, `engagement_id uuid`, `run_id uuid`,
// `reviewed_by uuid references auth.users(id)`. The demo report is the one
// exception: it is addressed by a readable slug in a public URL, and a UUID
// there would be a worse product for no security gain.
//
// So the policy accepts "a UUID, or one of these five". That is a closed set,
// which is the whole point. The previous version of that rule accepted "at most
// four segments of at most 24 characters", and an audit composed
// "ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified" — four
// segments, each under 24 — which passed assembly, passed the delivery gate,
// and rendered in the report header. A bound describes what a value may not
// exceed. It does not describe what the value IS.
//
// Adding a demo identifier means adding it here. Nothing else declares one; a
// test asserts that the demo report's identifiers all come from this file.

export const DEMO_REPORT_ID = "demo-harbor-ledger";
export const DEMO_ENGAGEMENT_ID = "demo-engagement";
export const DEMO_RUN_ID = "demo-run";
export const DEMO_ORGANIZATION_ID = "demo-organization";
export const DEMO_OPERATOR_ID = "demo-operator";

/** The complete set. The field policy accepts these and no other non-UUID id. */
export const DEMO_IDENTIFIERS = [
  DEMO_REPORT_ID,
  DEMO_ENGAGEMENT_ID,
  DEMO_RUN_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_OPERATOR_ID,
] as const;

export type DemoIdentifier = (typeof DEMO_IDENTIFIERS)[number];
