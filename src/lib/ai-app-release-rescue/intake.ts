import { z } from "zod";
import {
  RETENTION_POLICIES,
  evaluateIntake,
  type IntakeAttestations,
  type ReleaseRescueIntakeV1,
  type RetentionPolicy,
} from "@/lib/release-rescue-intake";
import { containsLikelySecret, isForbiddenEvidenceFilename } from "@/lib/release-rescue-redaction";
import {
  ACCESS_GRANT_METHODS,
  APP_TYPES,
  type AccessGrantMethod,
  type AppType,
} from "@/lib/ai-app-release-rescue/constants";

// The intake FORM layer.
//
// This file owns form ergonomics: field names, per-field error messages, what a
// customer is allowed to paste into a text box. It owns no rules. Every decision
// about whether an engagement may proceed is made by `evaluateIntake` in the
// contract module, and this layer's job is to hand it a well-formed submission
// and translate its refusals back into something a form can render.
//
// The split matters because the form is the attack surface and the contract is
// the authority. Keeping validation here would mean a second, weaker copy of the
// offer's rules living next to the HTML.

export const RESCUE_DEMO_ORGANIZATION_ID = "demo-organization";

export type IntakeFieldName =
  | "contactName"
  | "workEmail"
  | "repositoryUrl"
  | "appType"
  | "criticalWorkflow"
  | "criticalWorkflowEntryPoint"
  | "applicationName"
  | "repositoryHost"
  | "defaultBranch"
  | "accessGrantMethod"
  | "accessWindowDays"
  | "retentionPolicy"
  | "evidenceNotes"
  | "evidenceFileNames"
  | "remediationInterest"
  | "acknowledgements";

export type IntakeFieldErrors = Partial<Record<IntakeFieldName, string>>;

/** One checkbox per attestation, so the form and the contract cannot drift apart. */
export const ATTESTATION_FIELDS = [
  "authorizedToGrantRepositoryAccess",
  "ownsOrIsAuthorisedByOwnerOfTheCode",
  "accessGrantedIsReadOnly",
  "noProductionCredentialsProvided",
  "noEndUserPersonalDataProvided",
  "understandsNotPenetrationTest",
  "understandsNotComplianceCertification",
  "understandsNoSecurityGuarantee",
  "understandsFindingsRequireCustomerAction",
] as const satisfies readonly (keyof IntakeAttestations)[];

export type AttestationField = (typeof ATTESTATION_FIELDS)[number];

export const ATTESTATION_COPY: Record<AttestationField, string> = {
  authorizedToGrantRepositoryAccess:
    "I am authorised to grant access to this repository on behalf of whoever owns it.",
  ownsOrIsAuthorisedByOwnerOfTheCode:
    "My organisation owns this code, or its owner has authorised this review in writing.",
  accessGrantedIsReadOnly: "I will grant read-only access, and I can revoke it at any time.",
  noProductionCredentialsProvided: "I will not send production credentials, keys, or database access.",
  noEndUserPersonalDataProvided: "I will not send my end users' personal data.",
  understandsNotPenetrationTest: "I understand this is not a penetration test.",
  understandsNotComplianceCertification: "I understand this is not a compliance certification.",
  understandsNoSecurityGuarantee:
    "I understand this does not guarantee the absence of security vulnerabilities.",
  understandsFindingsRequireCustomerAction:
    "I understand the report identifies problems and my team fixes them.",
};

export const REPOSITORY_HOSTS = ["github", "gitlab", "bitbucket"] as const;
export type RepositoryHost = (typeof REPOSITORY_HOSTS)[number];

export const REPOSITORY_HOST_COPY: Record<RepositoryHost, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

/**
 * Facts about the application that only the customer knows.
 *
 * These were previously hardcoded to `true` while being written into the frozen,
 * hashed scope — so the scope asserted things the customer never said, and the
 * report bound itself to those assertions. Asking is the only honest option.
 */
export const SCOPE_FACT_FIELDS = [
  "usesAiFeatures",
  "handlesCustomerData",
  "triggersExternalActions",
] as const;
export type ScopeFactField = (typeof SCOPE_FACT_FIELDS)[number];

export const SCOPE_FACT_COPY: Record<ScopeFactField, string> = {
  usesAiFeatures: "This application uses AI features (a model, an assistant, or an agent).",
  handlesCustomerData: "This workflow handles customer data.",
  triggersExternalActions: "This workflow can send, publish, charge, or otherwise act outside the app.",
};

export const ACCESS_WINDOW_DAY_OPTIONS = [7, 14, 30] as const;
export type AccessWindowDays = (typeof ACCESS_WINDOW_DAY_OPTIONS)[number];

export const RETENTION_POLICY_COPY: Record<RetentionPolicy, string> = {
  purge_on_delivery: "Delete my source material as soon as the report is delivered",
  minimum_7_day: "Keep it for 7 days after delivery, then delete it",
  standard_30_day: "Keep it for 30 days after delivery, then delete it",
};

/** What the demo engagement keeps beyond the contract's scope: who to talk to. */
export type RescueIntakeContact = {
  contactName: string;
  workEmail: string;
  /**
   * Mirrors `intake.aiAssistedReviewAccepted` for the demo page. The contract is
   * authoritative and the report gate enforces it; this copy exists so the
   * confirmation screen can show the choice without reaching into the contract.
   */
  aiAssistedOptIn: boolean;
  remediationInterest: boolean;
  evidenceNotes: string;
  evidenceFileNames: string[];
};

export type RescueIntake = {
  contact: RescueIntakeContact;
  intake: ReleaseRescueIntakeV1;
  appType: AppType;
};

export type IntakeActionEcho = Record<string, string>;

export type RescueIntakeState = {
  errors: IntakeFieldErrors;
  formError: string | null;
  values: IntakeActionEcho;
};

export const initialRescueIntakeState: RescueIntakeState = { errors: {}, formError: null, values: {} };

export type IntakeParseResult =
  | { ok: true; intake: RescueIntake }
  | { ok: false; errors: IntakeFieldErrors; formError?: string };

const nameSchema = z.string().trim().min(1).max(80);
const emailSchema = z.email().max(120);
const workflowSchema = z.string().trim().min(12).max(500);

export type RepositoryReference = {
  provider: "github" | "gitlab" | "bitbucket";
  repositoryRef: string;
};

const PROVIDER_HOSTS: Record<string, RepositoryReference["provider"]> = {
  "github.com": "github",
  "www.github.com": "github",
  "gitlab.com": "gitlab",
  "www.gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  "www.bitbucket.org": "bitbucket",
};

/**
 * Accepts what a customer will actually paste, and yields what the contract stores.
 *
 * The contract refuses URL-shaped repository references, because a URL field is
 * an invitation to paste `https://user:token@github.com/acme/app` and hand us a
 * credential through a signup form. But refusing to accept a pasted GitHub URL
 * would be hostile, so this parses one and keeps only `owner/name` — after
 * rejecting outright anything carrying userinfo or a credential-shaped query.
 */
export function parseRepositoryReference(
  raw: string,
  /** Used only for a bare owner/name, where the host is not in the text. */
  hostWhenUnqualified: RepositoryHost = "github",
): { ok: true; value: RepositoryReference } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Add the repository you want reviewed." };

  if (!trimmed.includes("://")) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
      return { ok: false, reason: "Use owner/name, or paste the repository's https URL." };
    }
    // A bare owner/name carries no host, so the customer's chosen host decides.
    // Defaulting silently to GitHub recorded a GitLab repository as a GitHub one.
    return { ok: true, value: { provider: hostWhenUnqualified, repositoryRef: trimmed } };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That does not look like a repository URL." };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: "Remove the credentials from that URL. Access is granted separately." };
  }
  if (containsLikelySecret(trimmed)) {
    return { ok: false, reason: "That URL carries a token. Remove it. Access is granted separately." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Use an https URL." };
  }

  const provider = PROVIDER_HOSTS[url.hostname.toLowerCase()];
  if (!provider) {
    return { ok: false, reason: "We review repositories hosted on GitHub, GitLab, or Bitbucket." };
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return { ok: false, reason: "Point at one repository, for example github.com/acme/app." };
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return { ok: false, reason: "That repository name has characters we do not recognise." };
  }

  return { ok: true, value: { provider, repositoryRef: `${owner}/${name}` } };
}

/**
 * The longest field value this parser will look at.
 *
 * Applied at the BOUNDARY, before anything expensive runs, and to every field
 * rather than to the one that was noticed. An audit found `evidenceNotes` reached
 * `containsLikelySecret` before its own 2000-character check, and that the server
 * action echoed ~20 raw form fields through the same scanner with no cap at all —
 * so an anonymous POST could hold the event loop for as long as the body allowed.
 *
 * The scanner is near-linear now, which makes this a bound rather than a rescue.
 * It stays because a length limit at the edge is cheaper than trusting every
 * future caller to have read the performance notes.
 */
export const MAX_INTAKE_FIELD_LENGTH = 8_000;

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string") return "";
  // Truncated, not rejected: a too-long field is a validation error below, and
  // the truncation is only here so the validation itself is cheap.
  return value.length > MAX_INTAKE_FIELD_LENGTH ? value.slice(0, MAX_INTAKE_FIELD_LENGTH) : value;
}

function readChecked(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  return value === "on" || value === "true" || value === true;
}

/** Field names that would invite a customer to paste a credential. */
export function forbiddenIntakeFieldsPresent(source: Record<string, unknown>): string[] {
  return Object.keys(source).filter((key) =>
    /(^|_)(token|pat|password|secret|api[_-]?key|apikey|private[_-]?key|service_role|client_secret|ssh_key)($|_)/i.test(key),
  );
}

export function parseRescueIntake(source: Record<string, unknown>, now: Date = new Date()): IntakeParseResult {
  const errors: IntakeFieldErrors = {};

  const forbidden = forbiddenIntakeFieldsPresent(source);
  if (forbidden.length > 0) {
    return {
      ok: false,
      errors: {},
      formError: `This form does not accept credentials (${forbidden.join(", ")}). Nothing was stored.`,
    };
  }

  const contactName = nameSchema.safeParse(readString(source, "contactName"));
  if (!contactName.success) errors.contactName = "Add your name.";

  const workEmail = emailSchema.safeParse(readString(source, "workEmail").trim());
  if (!workEmail.success) errors.workEmail = "Add a work email we can send the report to.";

  const hostRaw = readString(source, "repositoryHost");
  const repositoryHost = (REPOSITORY_HOSTS as readonly string[]).includes(hostRaw)
    ? (hostRaw as RepositoryHost)
    : null;
  if (!repositoryHost) errors.repositoryHost = "Choose where the repository is hosted.";

  const repository = parseRepositoryReference(
    readString(source, "repositoryUrl"),
    repositoryHost ?? "github",
  );
  if (!repository.ok) errors.repositoryUrl = repository.reason;

  const applicationName = readString(source, "applicationName").trim();
  if (applicationName.length === 0) errors.applicationName = "What is this application called?";

  const defaultBranch = readString(source, "defaultBranch").trim() || "main";
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(defaultBranch)) {
    errors.defaultBranch = "Use the branch name, for example main.";
  }

  const appTypeRaw = readString(source, "appType");
  const appType = (APP_TYPES as readonly string[]).includes(appTypeRaw) ? (appTypeRaw as AppType) : null;
  if (!appType) errors.appType = "Choose the kind of application.";

  const workflow = workflowSchema.safeParse(readString(source, "criticalWorkflow"));
  if (!workflow.success) {
    errors.criticalWorkflow = "Describe the one workflow that must not break, in a sentence or two.";
  }

  const entryPoint = readString(source, "criticalWorkflowEntryPoint").trim();
  if (entryPoint.length === 0) errors.criticalWorkflowEntryPoint = "Where does that workflow start?";

  const accessRaw = readString(source, "accessGrantMethod");
  const accessGrantMethod = (ACCESS_GRANT_METHODS as readonly string[]).includes(accessRaw)
    ? (accessRaw as AccessGrantMethod)
    : null;
  if (!accessGrantMethod) errors.accessGrantMethod = "Choose how you will grant read-only access.";

  const windowRaw = Number.parseInt(readString(source, "accessWindowDays"), 10);
  const accessWindowDays = (ACCESS_WINDOW_DAY_OPTIONS as readonly number[]).includes(windowRaw)
    ? (windowRaw as AccessWindowDays)
    : null;
  if (!accessWindowDays) errors.accessWindowDays = "Choose how long that access stays open.";

  const retentionRaw = readString(source, "retentionPolicy");
  const retentionPolicy = (RETENTION_POLICIES as readonly string[]).includes(retentionRaw)
    ? (retentionRaw as RetentionPolicy)
    : null;
  if (!retentionPolicy) errors.retentionPolicy = "Choose how long we keep your source material.";

  const evidenceNotes = readString(source, "evidenceNotes").trim();
  // Length first. The credential scan is the expensive step, so it runs only on
  // input that has already passed the cheap check.
  if (evidenceNotes.length > 2000) {
    errors.evidenceNotes = "Keep this under 2000 characters.";
  } else if (containsLikelySecret(evidenceNotes)) {
    errors.evidenceNotes = "That looks like a credential. Remove it. Access is granted separately.";
  }

  const evidenceFileNames = readString(source, "evidenceFileNames")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const refusedFile = evidenceFileNames.find(isForbiddenEvidenceFilename);
  if (refusedFile) {
    errors.evidenceFileNames = `Do not send ${refusedFile}. That file is a credential, not evidence.`;
  } else if (evidenceFileNames.length > 20) {
    errors.evidenceFileNames = "List at most 20 files.";
  }

  const attestations = Object.fromEntries(
    ATTESTATION_FIELDS.map((field) => [field, readChecked(source, field)]),
  ) as Record<AttestationField, boolean>;
  const missingAttestation = ATTESTATION_FIELDS.find((field) => !attestations[field]);
  if (missingAttestation) {
    errors.acknowledgements = "Every statement has to be true before we can start.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const submittedAt = now.toISOString();
  const grantExpiresAt = new Date(now.getTime() + accessWindowDays! * 86_400_000).toISOString();

  const decision = evaluateIntake(
    {
      schemaVersion: "release-rescue-intake/v1",
      offerVersion: "release-rescue-offer/v1",
      organizationId: RESCUE_DEMO_ORGANIZATION_ID,
      repository: {
        provider: repository.ok ? repository.value.provider : "github",
        repositoryRef: repository.ok ? repository.value.repositoryRef : "",
        defaultBranch,
        accessMode: accessGrantMethod!,
      },
      application: {
        name: applicationName,
        description: workflow.success ? workflow.data : "",
        primaryStack: appType!,
        usesAiFeatures: readChecked(source, "usesAiFeatures"),
      },
      criticalWorkflow: {
        name: entryPoint,
        description: workflow.success ? workflow.data : "",
        entryPoint,
        handlesCustomerData: readChecked(source, "handlesCustomerData"),
        triggersExternalActions: readChecked(source, "triggersExternalActions"),
      },
      aiAssistedReviewAccepted: readChecked(source, "aiAssistedOptIn"),
      requestedServices: ["release_readiness_review", "ai_boundary_review"],
      customerExclusions: [],
      retentionPolicy: retentionPolicy!,
      grantExpiresAt,
      attestations,
      submittedAt,
    },
    now,
  );

  if (!decision.accepted) {
    return {
      ok: false,
      errors: {},
      formError: decision.refusals.map((refusal) => refusal.message).join(" "),
    };
  }

  return {
    ok: true,
    intake: {
      contact: {
        contactName: contactName.success ? contactName.data : "",
        workEmail: workEmail.success ? workEmail.data : "",
        aiAssistedOptIn: readChecked(source, "aiAssistedOptIn"),
        remediationInterest: readChecked(source, "remediationInterest"),
        evidenceNotes,
        evidenceFileNames,
      },
      intake: decision.intake,
      appType: appType!,
    },
  };
}

export function formDataToRecord(formData: FormData): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}
