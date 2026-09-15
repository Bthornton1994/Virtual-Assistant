import {
  CANONICAL_NON_CLAIMS,
  DEMO_SAMPLE_REPORT_ID,
  RESCUE_SCHEMA_VERSION,
} from "@/lib/ai-app-release-rescue/constants";
import { presentRescueReport, type RescueReport } from "@/lib/ai-app-release-rescue/report";

const SAMPLE_REPORT_INTERNAL: RescueReport = {
  schema_version: RESCUE_SCHEMA_VERSION,
  engagement_id: DEMO_SAMPLE_REPORT_ID,
  organization_id: "org_demo_internal",
  created_at: "2026-04-12T14:00:00.000Z",
  delivered_at: "2026-04-13T16:30:00.000Z",
  status: "delivered",
  scope: {
    repository_url: "https://github.com/example/harbor-ledger",
    repository_ref: "a1b2c3d4e5f6789012345678901234567890abcd",
    deployment_url: "https://harbor-ledger.example",
    app_type: "Next.js web application",
    critical_workflow: "Staff sign-in through creating an inventory receipt",
  },
  reviewer: {
    executor_type: "human",
    executor_id: "exec_demo_internal",
  },
  non_claims: [...CANONICAL_NON_CLAIMS],
  summary: {
    overall_readiness: "ready_with_caveats",
    critical_findings: 0,
    high_findings: 1,
    medium_findings: 2,
    low_findings: 1,
    informational_findings: 1,
    recommendation:
      "Harbor Ledger can ship after the session-cookie flag and the unlabeled receipt field are fixed. Remaining items can follow in a short sprint.",
    remediation_estimate: "The cookie flag, form label, and CI lint step are eligible for the $1,250 remediation sprint.",
  },
  rubric_scores: [
    {
      category: "code_quality",
      score: 4,
      label: "Good",
      summary: "TypeScript is strict and lint is configured locally. Critical-path tests exist for receipts.",
      findings_count: 0,
    },
    {
      category: "authentication",
      score: 2,
      label: "Needs work",
      summary: "Auth is present, but the session cookie in the sample config is missing the Secure attribute.",
      findings_count: 1,
    },
    {
      category: "data_access",
      score: 4,
      label: "Good",
      summary: "Queries go through a typed helper. Organization id is required on receipt reads.",
      findings_count: 0,
    },
    {
      category: "secrets_and_configuration",
      score: 3,
      label: "Acceptable",
      summary: "Secrets are expected in environment variables. CI does not scan for committed secrets.",
      findings_count: 1,
    },
    {
      category: "browser_flow",
      score: 4,
      label: "Good",
      summary: "The receipt workflow completes in the sample deployment, including the error path for a duplicate SKU.",
      findings_count: 0,
    },
    {
      category: "accessibility",
      score: 3,
      label: "Acceptable",
      summary: "The sign-in form is labeled. The quantity field on the receipt form is not.",
      findings_count: 1,
    },
    {
      category: "ci_cd",
      score: 3,
      label: "Acceptable",
      summary: "CI runs typecheck, test, and build. Lint is local-only.",
      findings_count: 1,
    },
    {
      category: "deployment",
      score: 4,
      label: "Good",
      summary: "HTTPS is enforced on the sample host. Basic error tracking is configured.",
      findings_count: 0,
    },
    {
      category: "evidence_and_documentation",
      score: 3,
      label: "Acceptable",
      summary: "README covers setup and test. Rollback is not documented.",
      findings_count: 1,
    },
  ],
  findings: [
    {
      id: "AUTH-001",
      category: "authentication",
      severity: "high",
      title: "Session cookie template omits the Secure attribute",
      description:
        "The sample session configuration sets HttpOnly and SameSite but does not set Secure. A cookie without Secure may be sent on plain HTTP if the app is ever reached that way.",
      evidence: {
        type: "config_reference",
        location: "src/lib/session.ts",
        snippet: 'cookies.set("session", token, { httpOnly: true, sameSite: "lax" })',
        observation: null,
      },
      impact: "A session cookie could be intercepted on an unencrypted connection.",
      recommendation: "Set Secure on the session cookie and reject non-HTTPS in production.",
      effort: "small",
      remediation_sprint_eligible: true,
      references: ["https://owasp.org/www-community/controls/SecureCookieAttribute"],
    },
    {
      id: "SEC-001",
      category: "secrets_and_configuration",
      severity: "medium",
      title: "No secret scanning in CI",
      description:
        "Environment templates list key names only. There is no CI job that fails when a secret-shaped value is committed. A sample comment shows the required redaction pattern, not a live value.",
      evidence: {
        type: "config_reference",
        location: ".github/workflows/ci.yml",
        snippet: `STRIPE_SECRET_KEY = "${"REDACTED_VALUE_FOUND_IN_SOURCE"}"`,
        observation: null,
      },
      impact: "A committed secret could reach the default branch without CI stopping the merge.",
      recommendation: "Add a secret-scanning step to CI and keep values out of the repository.",
      effort: "small",
      remediation_sprint_eligible: true,
      references: ["https://docs.github.com/en/code-security/secret-scanning"],
    },
    {
      id: "A11Y-001",
      category: "accessibility",
      severity: "medium",
      title: "Receipt quantity field has no accessible name",
      description:
        "The quantity input on the new-receipt form is rendered without a label or accessible name. Keyboard and screen-reader users cannot tell what the field is for.",
      evidence: {
        type: "code_reference",
        location: "src/app/receipts/new/page.tsx",
        snippet: "<input name=\"quantity\" type=\"number\" />",
        observation: "Keyboard focus lands on an unlabeled spinbutton in the sample deployment.",
      },
      impact: "Staff using a screen reader may submit the wrong quantity or abandon the receipt.",
      recommendation: "Associate a visible label with the quantity input and announce validation errors.",
      effort: "trivial",
      remediation_sprint_eligible: true,
      references: ["https://www.w3.org/WAI/WCAG22/Understanding/name-role-value"],
    },
    {
      id: "CI-001",
      category: "ci_cd",
      severity: "low",
      title: "Lint is not run in CI",
      description: "package.json has a lint script. The CI workflow runs typecheck, test, and build, but not lint.",
      evidence: {
        type: "config_reference",
        location: ".github/workflows/ci.yml",
        snippet: "run: npm run typecheck && npm test && npm run build",
        observation: null,
      },
      impact: "Style and some correctness issues can merge without the check the repo already defines.",
      recommendation: "Add npm run lint to the CI workflow and require it on the default branch.",
      effort: "trivial",
      remediation_sprint_eligible: true,
      references: [],
    },
    {
      id: "DOC-001",
      category: "evidence_and_documentation",
      severity: "informational",
      title: "README does not describe rollback",
      description: "Setup, test, and deploy are documented. There is no rollback or incident note for the production host.",
      evidence: {
        type: "code_reference",
        location: "README.md",
        snippet: "## Deploy\n\nnpm run build && vercel deploy --prod",
        observation: null,
      },
      impact: "A failed release would rely on undocumented operator memory.",
      recommendation: "Add a short rollback section that names the host action and who can run it.",
      effort: "small",
      remediation_sprint_eligible: false,
      references: [],
    },
  ],
  recommendations: {
    immediate: [
      { finding_id: "AUTH-001", action: "Set Secure on the session cookie before production traffic." },
      { finding_id: "A11Y-001", action: "Label the receipt quantity field on the critical workflow." },
    ],
    short_term: [{ finding_id: "CI-001", action: "Run lint in CI on every default-branch pull request." }],
    long_term: [{ finding_id: "DOC-001", action: "Document rollback beside the existing deploy section." }],
    remediation_sprint: {
      eligible: true,
      eligible_findings: ["AUTH-001", "SEC-001", "A11Y-001", "CI-001"],
      estimated_scope:
        "Session cookie flags, quantity label, CI lint step, and a secret-scan job. Documentation rollback is out of sprint unless time remains.",
    },
  },
  appendices: {
    dependency_summary: {
      total_dependencies: 42,
      outdated: 3,
      known_vulnerabilities: { critical: 0, high: 0, medium: 1, low: 2 },
      tool_used: "npm audit",
    },
    ci_cd_summary: {
      pipeline_present: true,
      lint_configured: false,
      typecheck_configured: true,
      test_configured: true,
      build_configured: true,
      deployment_target: "Vercel",
    },
    accessibility_summary: {
      tool_used: "keyboard walkthrough of the sample deployment",
      pages_tested: 2,
      critical_violations: 0,
      serious_violations: 1,
    },
    review_metadata: {
      review_start: "2026-04-12T14:00:00.000Z",
      review_end: "2026-04-13T15:10:00.000Z",
      repository_ref: "a1b2c3d4e5f6789012345678901234567890abcd",
      tools_used: ["repository review", "npm audit", "keyboard walkthrough"],
      ai_assisted: false,
      ai_provider: null,
    },
  },
};

const presented = presentRescueReport(SAMPLE_REPORT_INTERNAL);
if (!presented.hardGatePass || !presented.report || !presented.customerReport) {
  throw new Error(`Sample rescue report failed validation: ${presented.hardFailures.join("; ")}`);
}

export const SAMPLE_REPORT = presented.report;
export const SAMPLE_CUSTOMER_REPORT = presented.customerReport;
export const SAMPLE_REPORT_HASH = presented.contentHash ?? "";
export const SAMPLE_REPORT_IS_SYNTHETIC = true as const;
