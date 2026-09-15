export const RESCUE_SERVICE_ID = "WS-REV-01" as const;
export const RESCUE_SERVICE_NAME = "AI App Release Rescue";
export const RESCUE_SCHEMA_VERSION = "1.0.0";

export const RESCUE_REVIEW_PRICE_USD = 299;
export const RESCUE_REMEDIATION_PRICE_USD = 1250;

export const RESCUE_AUTHORITY = {
  review: "prepare_only",
  remediation: "low_risk_execution",
} as const;

export const RESCUE_SCOPE_LIMIT = {
  repositories: 1,
  webApplications: 1,
  criticalWorkflows: 1,
} as const;

export const ENGAGEMENT_STATUSES = [
  "intake",
  "scope_confirmed",
  "access_granted",
  "review_active",
  "draft_report",
  "customer_review",
  "delivered",
  "access_revoked",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  intake: ["scope_confirmed"],
  scope_confirmed: ["access_granted"],
  access_granted: ["review_active"],
  review_active: ["draft_report"],
  draft_report: ["customer_review"],
  customer_review: ["delivered"],
  delivered: ["access_revoked"],
  access_revoked: [],
};

export const ACCESS_GRANT_METHODS = [
  "github_collaborator_read_only",
  "deploy_key_read_only",
  "other_read_only_grant",
] as const;
export type AccessGrantMethod = (typeof ACCESS_GRANT_METHODS)[number];

export const ACCESS_GRANT_METHOD_COPY: Record<AccessGrantMethod, string> = {
  github_collaborator_read_only: "GitHub read-only collaborator invite (no token pasted here)",
  deploy_key_read_only: "Read-only deploy key (granted in GitHub, not pasted here)",
  other_read_only_grant: "Another read-only grant I will set up with the operator",
};

export const APP_TYPES = [
  "next_js_web_app",
  "react_spa",
  "other_web_app",
] as const;
export type AppType = (typeof APP_TYPES)[number];

export const APP_TYPE_COPY: Record<AppType, string> = {
  next_js_web_app: "Next.js web application",
  react_spa: "React single-page application",
  other_web_app: "Other web application",
};

export const RUBRIC_CATEGORIES = [
  "code_quality",
  "authentication",
  "data_access",
  "secrets_and_configuration",
  "browser_flow",
  "accessibility",
  "ci_cd",
  "deployment",
  "evidence_and_documentation",
] as const;
export type RubricCategory = (typeof RUBRIC_CATEGORIES)[number];

export const RUBRIC_CATEGORY_COPY: Record<
  RubricCategory,
  { title: string; examines: string }
> = {
  code_quality: {
    title: "Code quality",
    examines: "Structure, types, error handling, dependency health, lint, and tests on critical paths.",
  },
  authentication: {
    title: "Authentication",
    examines: "Sessions, token storage, route protection, credential handling, and auth bypass risk.",
  },
  data_access: {
    title: "Data access",
    examines: "Query safety, input validation, authorization on data operations, and tenant isolation.",
  },
  secrets_and_configuration: {
    title: "Secrets and configuration",
    examines: "Secret storage patterns, committed credentials, env separation, and client-bundle exposure.",
  },
  browser_flow: {
    title: "Browser flow",
    examines: "The named critical workflow, error and loading states, and browser security headers.",
  },
  accessibility: {
    title: "Accessibility",
    examines: "Semantics, keyboard path, labels, contrast, focus, and reduced-motion support.",
  },
  ci_cd: {
    title: "CI/CD",
    examines: "Pipeline presence, lint/typecheck/test/build, branch protection, and secret injection.",
  },
  deployment: {
    title: "Deployment",
    examines: "Hosting fit, HTTPS, env var management, monitoring, and basic recovery posture.",
  },
  evidence_and_documentation: {
    title: "Evidence and documentation",
    examines: "README, setup, known limits, and whether a new engineer can run and test the app.",
  },
};

export const SCORE_LABELS = {
  1: "Critical gaps",
  2: "Needs work",
  3: "Acceptable",
  4: "Good",
  5: "Excellent",
} as const;
export type RubricScore = 1 | 2 | 3 | 4 | 5;

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const EVIDENCE_TYPES = [
  "code_reference",
  "config_reference",
  "runtime_observation",
  "dependency_report",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EFFORT_LEVELS = ["trivial", "small", "medium", "large"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const READINESS_LEVELS = ["ready", "ready_with_caveats", "not_ready"] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export const READINESS_COPY: Record<ReadinessLevel, string> = {
  ready: "No critical or high findings. The app can ship with minor attention.",
  ready_with_caveats: "No critical findings. High findings should be handled before or shortly after launch.",
  not_ready: "Critical findings should be resolved before a production release.",
};

export const REPORT_STATUSES = ["draft", "delivered", "superseded"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const EXECUTOR_TYPES = ["human", "ai_assisted", "hybrid"] as const;
export type ExecutorType = (typeof EXECUTOR_TYPES)[number];

export const CANONICAL_NON_CLAIMS = [
  "This review is not a penetration test.",
  "This review is not a compliance certification.",
  "This review does not guarantee the absence of security vulnerabilities.",
  "Findings are based on source-code review and observable behavior at a point in time.",
] as const;

export const REPORT_LIMITATIONS_VERBATIM = `This review is not a penetration test. It is not a compliance certification
(SOC 2, ISO 27001, HIPAA, PCI DSS, or any other standard). It does not
guarantee the absence of security vulnerabilities.

Findings are based on source-code review and observable behavior at a
specific point in time. Changes made after the reviewed commit are not
covered.

This review covers one repository, one web application, and one critical
workflow. It does not constitute legal, regulatory, or professional advice.

Customers who need penetration testing, compliance certification, or
ongoing security monitoring should engage qualified specialists for those
services.`;

export const FORBIDDEN_INTAKE_FIELD_NAMES = [
  "token",
  "pat",
  "password",
  "secret",
  "access_token",
  "api_key",
  "private_key",
  "service_role",
  "stripe_secret",
] as const;

export const DEMO_SAMPLE_REPORT_ID = "demo-harbor-ledger";
export const DEMO_ENGAGEMENT_COOKIE = "dc_rescue_demo";
export const RESCUE_PATH = "/ai-app-release-rescue";
