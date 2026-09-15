import { z } from "zod";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";

// Customer intake boundary for the AI App Release Rescue offer.
//
// Intake is the only place where what the customer wants is reconciled with what
// the offer actually is. Everything downstream (rubric, findings, report) assumes
// a scope that already passed through here, so this module fails closed: an
// intake that does not parse produces refusals, never a partially accepted
// engagement.
//
// Three boundaries are enforced here and nowhere else:
//
//   1. SCOPE CEILING. Exactly one repository, one application, one critical
//      workflow. A fixed price is only honest against a fixed scope.
//   2. SERVICE REFUSALS. Penetration testing, compliance certification, a
//      security guarantee, production access, and remediation implementation are
//      refused at intake rather than disclaimed later in the report.
//   3. ACCESS AND RETENTION. The customer states read-only access, attests they
//      are authorized to grant it, and elects a retention period up front. There
//      is no default that quietly keeps their code longer than they chose.

export const RELEASE_RESCUE_INTAKE_SCHEMA_VERSION = "release-rescue-intake/v1" as const;
export const RELEASE_RESCUE_OFFER_VERSION = "release-rescue-offer/v1" as const;

/**
 * The commercial shape of the offer, in one place, so the marketing surface,
 * the intake boundary, and any future billing path cannot drift apart.
 *
 * Money is recorded in cents to keep it integral. No payment is activated by
 * this module; these are the declared terms, not a charge.
 */
export const RELEASE_RESCUE_OFFER = {
  version: RELEASE_RESCUE_OFFER_VERSION,
  reviewSku: "release-rescue-review",
  reviewPriceCents: 29_900,
  remediationSprintSku: "release-rescue-remediation-sprint",
  remediationSprintPriceCents: 125_000,
  currency: "USD",
  scopeCeiling: {
    repositories: 1,
    applications: 1,
    criticalWorkflows: 1,
  },
  /** Claims this offer must never make, in any surface. */
  prohibitedClaims: [
    "penetration test",
    "compliance certification",
    "security guarantee",
    "vulnerability-free",
    "audit certification",
  ],
} as const;

// --- Requested services -------------------------------------------------------------

/**
 * What a customer can ask for at intake. Splitting this into an enum rather than
 * matching free text means the boundary is decidable: we never try to guess
 * whether a paragraph of prose was a request for a penetration test.
 */
export const REQUESTABLE_SERVICES = [
  "release_readiness_review",
  "ai_boundary_review",
  "remediation_sprint_quote",
  "penetration_test",
  "compliance_certification",
  "security_guarantee",
  "production_environment_access",
  "remediation_implementation",
  "third_party_vendor_assessment",
] as const;

export type RequestableService = (typeof REQUESTABLE_SERVICES)[number];

/** Services the $299 review includes. */
export const IN_SCOPE_SERVICES: ReadonlySet<RequestableService> = new Set<RequestableService>([
  "release_readiness_review",
  "ai_boundary_review",
  "remediation_sprint_quote",
]);

/**
 * Services this offer refuses, each with the reason the customer is given.
 *
 * `remediation_implementation` is refused from the REVIEW specifically: it is the
 * separate paid sprint. Refusing it here keeps the reviewer from drifting into
 * unbilled implementation work and keeps the reviewer's independence from the
 * remediation it may later recommend.
 */
export const REFUSED_SERVICE_REASONS: Readonly<Record<string, string>> = {
  penetration_test:
    "This review reads code, configuration, and policy. It does not attack a running system, so it cannot be sold or described as a penetration test.",
  compliance_certification:
    "This review is not an audit against SOC 2, ISO 27001, HIPAA, PCI DSS, or any other framework, and it certifies nothing.",
  security_guarantee:
    "No review can establish the absence of vulnerabilities. The report states what was examined and what was found, and guarantees nothing.",
  production_environment_access:
    "The review works from a read-only source snapshot. Delegation Cloud does not take production credentials, production database access, or customer end-user data.",
  remediation_implementation:
    "Implementation is the separate remediation sprint. The review identifies and prioritizes; it does not change the customer's code.",
  third_party_vendor_assessment:
    "The review covers one repository and one application the customer controls. Assessing a third-party vendor is out of scope.",
};

// --- Retention ----------------------------------------------------------------------

export const RETENTION_POLICIES = ["purge_on_delivery", "minimum_7_day", "standard_30_day"] as const;
export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

/**
 * Retention days by policy. These are ceilings on how long customer source
 * material is held after delivery, not targets. `purge_on_delivery` keeps
 * nothing beyond the accounting record once the report is handed over.
 */
export const RETENTION_DAYS: Readonly<Record<RetentionPolicy, number>> = {
  purge_on_delivery: 0,
  minimum_7_day: 7,
  standard_30_day: 30,
};

export const MAX_RETENTION_DAYS = 30;

/** Read-only, time-boxed. There is no write mode and no long-lived mode. */
export const REPOSITORY_ACCESS_MODES = [
  "customer_installed_readonly_app",
  "customer_added_readonly_collaborator",
  "customer_uploaded_archive",
] as const;
export type RepositoryAccessMode = (typeof REPOSITORY_ACCESS_MODES)[number];

export const MAX_GRANT_WINDOW_DAYS = 30;

// --- Schemas ------------------------------------------------------------------------

/**
 * A repository named as `owner/name` on a known host, or an uploaded archive.
 *
 * Deliberately NOT a URL: a URL field invites `https://user:token@host/owner/repo`,
 * which is a credential arriving through an intake form and landing in a database
 * column. Refusing the shape removes the opportunity rather than trying to scrub
 * it afterwards.
 */
export const repositoryRefSchema = identifierString
  .max(200)
  .refine((value) => !value.includes("://"), "must be an owner/name reference, not a URL")
  .refine((value) => !value.includes("@"), "must not contain credentials or an @ host reference")
  .refine((value) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value), "must look like owner/name");

/**
 * What the customer can state at intake.
 *
 * Deliberately no commit sha. At intake the customer has not granted access yet,
 * so they cannot know which commit we will review \u2014 asking them to paste a
 * 40-character hash into a signup form would be unanswerable as well as rude.
 * The commit is resolved when the snapshot is taken and enters the frozen scope
 * then, via `freezeScope`.
 */
export const repositoryIntakeSchema = z
  .object({
    provider: z.enum(["github", "gitlab", "bitbucket", "uploaded_archive"]),
    repositoryRef: repositoryRefSchema,
    defaultBranch: identifierString.max(200),
    accessMode: z.enum(REPOSITORY_ACCESS_MODES),
  })
  .strict();

export const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be a full 40-character lowercase commit sha");

/**
 * The repository as the REPORT records it: everything from intake plus the exact
 * commit reviewed. A review that cannot name what it reviewed is not
 * reproducible and cannot be defended later.
 */
export const repositoryScopeSchema = repositoryIntakeSchema.extend({
  commitSha: commitShaSchema,
});

export const applicationScopeSchema = z
  .object({
    name: nonEmptyString.max(200),
    /** What the app is, in the customer's words. Used verbatim in the report header. */
    description: nonEmptyString.max(2000),
    primaryStack: nonEmptyString.max(200),
    usesAiFeatures: z.boolean(),
  })
  .strict();

export const criticalWorkflowScopeSchema = z
  .object({
    name: nonEmptyString.max(200),
    /** The one path through the app that must not fail on release day. */
    description: nonEmptyString.max(2000),
    entryPoint: nonEmptyString.max(500),
    handlesCustomerData: z.boolean(),
    triggersExternalActions: z.boolean(),
  })
  .strict();

/**
 * Attestations the customer makes at intake.
 *
 * Every one is `z.literal(true)`: an intake where any of these is false does not
 * parse. That is the point. A customer who cannot attest they are authorized to
 * grant repository access does not have an engagement that needs a warning
 * banner; they have an engagement that must not start.
 */
export const intakeAttestationsSchema = z
  .object({
    authorizedToGrantRepositoryAccess: z.literal(true),
    accessGrantedIsReadOnly: z.literal(true),
    noProductionCredentialsProvided: z.literal(true),
    noEndUserPersonalDataProvided: z.literal(true),
    understandsNotPenetrationTest: z.literal(true),
    understandsNotComplianceCertification: z.literal(true),
    understandsNoSecurityGuarantee: z.literal(true),
    understandsFindingsRequireCustomerAction: z.literal(true),
  })
  .strict();

export type IntakeAttestations = z.infer<typeof intakeAttestationsSchema>;

export const releaseRescueIntakeV1Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_RESCUE_INTAKE_SCHEMA_VERSION),
    offerVersion: z.literal(RELEASE_RESCUE_OFFER_VERSION),
    organizationId: identifierString,
    repository: repositoryIntakeSchema,
    application: applicationScopeSchema,
    criticalWorkflow: criticalWorkflowScopeSchema,
    requestedServices: z.array(z.enum(REQUESTABLE_SERVICES)).min(1),
    /** Areas the customer explicitly asks the review to leave alone. */
    customerExclusions: z.array(nonEmptyString.max(500)).max(20),
    retentionPolicy: z.enum(RETENTION_POLICIES),
    grantExpiresAt: isoDateTimeSchema,
    attestations: intakeAttestationsSchema,
    submittedAt: isoDateTimeSchema,
  })
  .strict();

export type ReleaseRescueIntakeV1 = z.infer<typeof releaseRescueIntakeV1Schema>;

// --- Frozen scope -------------------------------------------------------------------

/**
 * The part of an intake the report is bound to. Contact details and commercial
 * terms are deliberately absent: the scope is what a reader needs to know what
 * was reviewed, and it is hashed into every report.
 */
export type ReleaseRescueScope = {
  offerVersion: typeof RELEASE_RESCUE_OFFER_VERSION;
  repository: z.infer<typeof repositoryScopeSchema>;
  application: z.infer<typeof applicationScopeSchema>;
  criticalWorkflow: z.infer<typeof criticalWorkflowScopeSchema>;
  customerExclusions: string[];
};

/**
 * Freezes an accepted intake against the commit actually snapshotted.
 *
 * This is the moment the review target stops moving. Everything downstream \u2014 the
 * scope hash, the report binding, what we can defend having reviewed \u2014 is fixed
 * here, which is why the commit is a required argument rather than an optional
 * field someone could forget to set.
 */
export function freezeScope(intake: ReleaseRescueIntakeV1, commitSha: string): ReleaseRescueScope {
  return {
    offerVersion: intake.offerVersion,
    repository: { ...intake.repository, commitSha: commitShaSchema.parse(commitSha) },
    application: intake.application,
    criticalWorkflow: intake.criticalWorkflow,
    customerExclusions: [...intake.customerExclusions],
  };
}

export function hashScope(scope: ReleaseRescueScope): string {
  return sha256Hex(scope);
}

export function canonicalScopeJson(scope: ReleaseRescueScope): string {
  return canonicalJsonStringify(scope);
}

// --- Boundary -----------------------------------------------------------------------

export type IntakeRefusal = {
  /** Machine-readable reason, stable for tests and for any future UI mapping. */
  code:
    | "schema_violation"
    | "service_out_of_scope"
    | "no_in_scope_service_requested"
    | "grant_window_invalid"
    | "grant_window_too_long"
    | "retention_exceeds_maximum";
  message: string;
};

export type IntakeDecision =
  | {
      accepted: true;
      intake: ReleaseRescueIntakeV1;
      retentionDays: number;
      /** In-scope services, in rubric-facing order. */
      acceptedServices: RequestableService[];
      /** Out-of-scope asks that were dropped, each with the reason the customer is told. */
      declinedServices: Array<{ service: RequestableService; reason: string }>;
    }
  | { accepted: false; refusals: IntakeRefusal[] };

/**
 * Validates one intake submission against the offer boundary.
 *
 * Out-of-scope services are DECLINED, not fatal: a customer who asks for a
 * review and also asks whether we do penetration testing should get the review
 * and a clear no, not a rejected form. An intake that asks for nothing in scope
 * is refused, because there is no engagement left to run.
 *
 * Pure and clock-free: `now` is a parameter so the grant-window rule is testable
 * and so two callers evaluating the same submission cannot disagree.
 */
export function evaluateIntake(input: unknown, now: Date): IntakeDecision {
  const parsed = releaseRescueIntakeV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      accepted: false,
      refusals: parsed.error.issues.map((issue) => ({
        code: "schema_violation" as const,
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    };
  }

  const intake = parsed.data;
  const refusals: IntakeRefusal[] = [];

  const requested = [...new Set(intake.requestedServices)];
  const acceptedServices = requested.filter((service) => IN_SCOPE_SERVICES.has(service));
  const declinedServices = requested
    .filter((service) => !IN_SCOPE_SERVICES.has(service))
    .map((service) => ({
      service,
      reason: REFUSED_SERVICE_REASONS[service] ?? "This service is outside the Release Rescue review offer.",
    }));

  if (acceptedServices.length === 0) {
    refusals.push({
      code: "no_in_scope_service_requested",
      message:
        "This submission requests no service the Release Rescue review provides. The review covers release-readiness review, AI boundary review, and a remediation sprint quote.",
    });
  }

  const grantExpiry = new Date(intake.grantExpiresAt);
  const submitted = new Date(intake.submittedAt);
  if (grantExpiry.getTime() <= now.getTime()) {
    refusals.push({
      code: "grant_window_invalid",
      message: "The repository access grant must expire in the future.",
    });
  }
  const maxExpiry = submitted.getTime() + MAX_GRANT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (grantExpiry.getTime() > maxExpiry) {
    refusals.push({
      code: "grant_window_too_long",
      message: `A repository access grant may not exceed ${MAX_GRANT_WINDOW_DAYS} days from submission.`,
    });
  }

  const retentionDays = RETENTION_DAYS[intake.retentionPolicy];
  if (retentionDays > MAX_RETENTION_DAYS) {
    refusals.push({
      code: "retention_exceeds_maximum",
      message: `Retention may not exceed ${MAX_RETENTION_DAYS} days.`,
    });
  }

  if (refusals.length > 0) return { accepted: false, refusals };

  return {
    accepted: true,
    intake,
    retentionDays,
    acceptedServices,
    declinedServices,
  };
}

/**
 * Words that turn a prohibited phrase into a permitted denial of it.
 *
 * "This review is not a penetration test" is exactly what the customer must be
 * told, and it necessarily contains the phrase "penetration test". A plain
 * substring match cannot tell a claim from its denial, so the clause around each
 * occurrence is checked for a negation first.
 */
const NEGATION_MARKERS = [
  "not",
  "n't",
  "never",
  "no ",
  "without",
  "unlike",
  "excludes",
  "excluding",
  "rather than",
  "instead of",
  "neither",
  "nor ",
  "cannot",
  "refuse",
];

/**
 * Phrases that mark a sentence as pointing the customer ELSEWHERE for the thing
 * named, rather than offering it. "Customers who need penetration testing should
 * engage qualified specialists" is a referral, and refusing to let us write it
 * would be perverse: it is the sentence that tells someone we are not their
 * answer.
 */
const REFERRAL_MARKERS = [
  "who need",
  "who want",
  "who require",
  "if you need",
  "if you want",
  "if you require",
  "engage",
  "elsewhere",
  "specialist",
  "separate engagement",
  "out of scope",
  "outside this",
  "outside the scope",
];

/** The sentence containing `index`. */
function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf("!"), before.lastIndexOf("?"));
  const afterOffset = text.slice(index).search(/[.\n!?]/);
  const end = afterOffset === -1 ? text.length : index + afterOffset;
  return text.slice(start + 1, end);
}

/** The clause containing `index`, bounded by sentence and clause punctuation. */
function clauseAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf(","),
    before.lastIndexOf(":"),
    before.lastIndexOf("\n"),
    before.lastIndexOf("\u2014"),
    before.lastIndexOf("("),
  );
  return text.slice(start + 1, index);
}

/**
 * Guards any customer-facing string this offer produces against the claims it
 * must never make. Used by the report contract; also available to the marketing
 * surface so one list governs both.
 *
 * Reports an affirmative claim only. A denial ("this is not a penetration test",
 * "we do not certify compliance") is required copy, not a violation.
 */
export function findProhibitedClaims(text: string): string[] {
  const haystack = text.toLowerCase();
  const found: string[] = [];

  for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
    let index = haystack.indexOf(claim);
    while (index !== -1) {
      const clause = clauseAround(haystack, index);
      const sentence = sentenceAround(haystack, index);
      const denied =
        NEGATION_MARKERS.some((marker) => clause.includes(marker)) ||
        REFERRAL_MARKERS.some((marker) => sentence.includes(marker));
      if (!denied) {
        found.push(claim);
        break;
      }
      index = haystack.indexOf(claim, index + claim.length);
    }
  }

  return found;
}
