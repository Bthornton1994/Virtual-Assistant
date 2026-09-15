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
  /**
   * Claims this offer must never make, in any surface.
   *
   * Phrases are matched on word boundaries with whitespace normalised, so
   * spacing and punctuation cannot smuggle one past. Variants are listed
   * explicitly rather than relying on a clever pattern, because a list is
   * auditable and a regex is not.
   */
  prohibitedClaims: [
    "penetration test",
    "penetration testing",
    "pen test",
    "pen testing",
    "pentest",
    "pentesting",
    "compliance certification",
    "audit certification",
    "certified secure",
    "security certification",
    "soc 2 certified",
    "iso 27001 certified",
    "security guarantee",
    "guarantee your security",
    "guaranteed secure",
    "vulnerability-free",
    "vulnerability free",
    "free of vulnerabilities",
    "absence of vulnerabilities",
    "no vulnerabilities",
    "is secure",
    "will be secure",
    "fully secure",
    "completely secure",
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

/**
 * Whether granting access this way also DEMONSTRATES control of the code.
 *
 * This distinction is the control against the worst abuse of this service:
 * pointing us at someone else's repository, buying a security report on it, and
 * using the findings against them.
 *
 * Installing an app or adding a collaborator requires an action inside the
 * customer's own provider account on that specific repository. Only someone who
 * already controls it can do that, so the grant is itself evidence.
 *
 * Uploading an archive demonstrates nothing at all. Anyone can download a public
 * repository, or receive a private one, and upload the zip. An attestation is a
 * promise, not proof, so an archive engagement additionally requires a named
 * human at Delegation Cloud to confirm ownership before the review may start.
 */
export const ACCESS_MODE_DEMONSTRATES_CONTROL: Record<RepositoryAccessMode, boolean> = {
  customer_installed_readonly_app: true,
  customer_added_readonly_collaborator: true,
  customer_uploaded_archive: false,
};

export function accessModeDemonstratesControl(mode: RepositoryAccessMode): boolean {
  return ACCESS_MODE_DEMONSTRATES_CONTROL[mode];
}

/** How an archive engagement's ownership was established by a human, not asserted by the customer. */
export const ARCHIVE_OWNERSHIP_CONFIRMATIONS = [
  "provider_ownership_verified_by_operator",
  "signed_authorization_letter_on_file",
  "existing_contracted_customer_of_record",
] as const;
export type ArchiveOwnershipConfirmation = (typeof ARCHIVE_OWNERSHIP_CONFIRMATIONS)[number];

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
    /**
     * Necessary, never sufficient. For an archive this is the ONLY thing the
     * customer offers, which is why an archive also needs operator confirmation.
     */
    authorizedToGrantRepositoryAccess: z.literal(true),
    ownsOrIsAuthorisedByOwnerOfTheCode: z.literal(true),
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
    /**
     * Whether the customer accepts an AI-assisted review.
     *
     * False means human-only, and that is ENFORCED rather than noted: the frozen
     * scope carries this value, the report validator rejects an agent-prepared
     * report for a human-only engagement, and the delivery gate refuses it
     * again. A privacy choice a customer makes at intake and the pipeline then
     * ignores is worse than not offering the choice.
     */
    aiAssistedReviewAccepted: z.boolean(),
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
  /** Carried into the frozen scope so the report is bound to the choice. */
  aiAssistedReviewAccepted: boolean;
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
    aiAssistedReviewAccepted: intake.aiAssistedReviewAccepted,
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
      /**
       * True when the chosen access mode proves nothing about who controls the
       * code. The engagement may be created, but the review must not start until
       * a named operator records how ownership was established. Enforced again in
       * the database, because an application-only gate is a gate someone can
       * route around.
       */
      requiresOperatorOwnershipConfirmation: boolean;
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
    requiresOperatorOwnershipConfirmation: !accessModeDemonstratesControl(intake.repository.accessMode),
    acceptedServices,
    declinedServices,
  };
}

/**
 * Tokens that turn a prohibited phrase into a permitted denial of it.
 *
 * "This review is not a penetration test" is exactly what the customer must be
 * told, and it necessarily contains the phrase. So the clause around each
 * occurrence is checked for a negation first.
 *
 * Matched as whole TOKENS, never as substrings. The earlier version tested
 * `clause.includes("not")`, which meant "Nothing is left unchecked in our
 * penetration test" and "Note that we provide a compliance certification" both
 * read as denials, because "nothing" and "note" contain "not".
 */
const NEGATION_TOKENS = new Set([
  "not",
  "never",
  "no",
  "none",
  "nor",
  "neither",
  "without",
  "unlike",
  "excludes",
  "excluding",
  "cannot",
  "refuse",
  "refuses",
  "isn't",
  "isnt",
  "aren't",
  "arent",
  "doesn't",
  "doesnt",
  "don't",
  "dont",
  "won't",
  "wont",
]);

/** Multi-word denials that no single token captures. */
const NEGATION_PHRASES = ["rather than", "instead of", "other than"];

/**
 * Clause shapes that point the customer ELSEWHERE for the thing named.
 *
 * Deliberately narrow, and matched against the CLAUSE rather than the sentence.
 * The earlier version scanned the whole sentence for "engage" and "specialist",
 * which exempted every sentence containing the word "engagement" — a word this
 * product uses constantly. That hole made the entire check optional.
 */
const REFERRAL_PHRASES = [
  "who need",
  "who want",
  "who require",
  "if you need",
  "if you want",
  "if you require",
  "should engage",
  "engage a qualified",
  "engage qualified",
  "out of scope",
  "outside the scope",
];

/** Lowercased, whitespace-normalised, punctuation-stripped word tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function containsNegation(clause: string): boolean {
  const tokens = tokenize(clause);
  if (tokens.some((token) => NEGATION_TOKENS.has(token))) return true;
  const normalised = tokens.join(" ");
  return NEGATION_PHRASES.some((phrase) => normalised.includes(phrase));
}

/**
 * Referral is matched against the whole SENTENCE, negation only against the
 * clause. The scopes differ because the failure modes differ.
 *
 * A referral naturally lists several things at once — "customers who need
 * penetration testing, compliance certification, or ongoing monitoring should
 * engage a qualified specialist" — and clause splitting on the comma would
 * isolate "compliance certification" from the "who need" that licenses it.
 * Sentence scope is safe here only because REFERRAL_PHRASES are narrow; the
 * earlier version scanned sentences for "engage" and "specialist", which
 * exempted every sentence containing the word "engagement".
 *
 * Negation stays clause-scoped so an earlier denial cannot license a later
 * claim: "We are not a consultancy; we deliver a penetration test."
 */
function containsReferral(sentence: string): boolean {
  const normalised = tokenize(sentence).join(" ");
  return REFERRAL_PHRASES.some((phrase) => normalised.includes(phrase));
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    ...[".", "\n", "!", "?"].map((mark) => text.lastIndexOf(mark, index - 1)),
  );
  const rest = text.slice(index).search(/[.\n!?]/);
  return text.slice(start + 1, rest === -1 ? text.length : index + rest);
}

/**
 * Guards any customer-facing string this offer produces against the claims it
 * must never make. Used by the report contract and by a test that runs it over
 * every marketing surface, so one list genuinely governs both.
 *
 * Reports an affirmative claim only. A denial ("this is not a penetration
 * test") and a referral ("customers who need penetration testing should engage
 * a qualified specialist") are required copy, not violations.
 */
export function findProhibitedClaims(text: string): string[] {
  // Normalise whitespace so "penetration  test" and "penetration\ntest" cannot
  // slip past a literal match, while keeping clause punctuation for splitting.
  const normalised = text.replace(/\s+/g, " ");
  const lower = normalised.toLowerCase();
  const found: string[] = [];

  for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
    // Word-bounded search, so "is secure" does not fire inside "this is securely
    // stored" and "pentest" does not fire inside "pentester".
    const pattern = new RegExp(`(^|[^a-z0-9])${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "g");
    let match = pattern.exec(lower);
    while (match !== null) {
      const index = match.index + match[1].length;
      const clauseStart = Math.max(
        ...[".", ";", ",", ":", "\u2014", "(", "?", "!"].map((mark) => lower.lastIndexOf(mark, index - 1)),
      );
      const clause = lower.slice(clauseStart + 1, index);
      if (!containsNegation(clause) && !containsReferral(sentenceAround(lower, index))) {
        found.push(claim);
        break;
      }
      pattern.lastIndex = index + claim.length;
      match = pattern.exec(lower);
    }
  }

  return found;
}

