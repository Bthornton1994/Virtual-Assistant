import { z } from "zod";
import {
  ACCESS_GRANT_METHODS,
  APP_TYPES,
  FORBIDDEN_INTAKE_FIELD_NAMES,
  type AccessGrantMethod,
  type AppType,
} from "@/lib/ai-app-release-rescue/constants";
import { isForbiddenEvidenceFilename, scanTextForSecrets, urlContainsCredentials } from "@/lib/ai-app-release-rescue/secrets";

export type IntakeFieldErrors = Partial<Record<IntakeFieldName, string>>;

export type IntakeFieldName =
  | "contactName"
  | "workEmail"
  | "repositoryUrl"
  | "appType"
  | "criticalWorkflow"
  | "deploymentUrl"
  | "accessGrantMethod"
  | "aiAssistedOptIn"
  | "evidenceNotes"
  | "evidenceFileNames"
  | "remediationInterest"
  | "acknowledgements";

export type RescueIntake = {
  contactName: string;
  workEmail: string;
  repositoryUrl: string;
  appType: AppType;
  criticalWorkflow: string;
  deploymentUrl: string | null;
  accessGrantMethod: AccessGrantMethod;
  aiAssistedOptIn: boolean;
  evidenceNotes: string;
  evidenceFileNames: string[];
  remediationInterest: boolean;
};

export type IntakeActionEcho = Record<string, string>;

export type RescueIntakeState = {
  errors: IntakeFieldErrors;
  formError: string | null;
  values: IntakeActionEcho;
};

export const initialRescueIntakeState: RescueIntakeState = {
  errors: {},
  formError: null,
  values: {},
};

export type IntakeParseResult =
  | { ok: true; intake: RescueIntake }
  | { ok: false; errors: IntakeFieldErrors; formError?: string };

const nameSchema = z.string().trim().min(1).max(80);
const emailSchema = z.email().max(120);
const workflowSchema = z.string().trim().min(12).max(500);
const notesSchema = z.string().trim().max(2000);

function parsePublicHttpsUrl(raw: string, label: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (raw !== raw.trim()) return { ok: false, reason: `${label} must not have leading or trailing spaces.` };
  if (!raw) return { ok: false, reason: `${label} is required.` };
  if (/\s/.test(raw)) return { ok: false, reason: `${label} must be a single URL with no spaces.` };
  if ((raw.match(/https?:\/\//g) ?? []).length > 1) {
    return { ok: false, reason: "Scope is one repository. Submit a single URL." };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `${label} must be a valid https URL.` };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: `${label} must use https.` };
  if (urlContainsCredentials(raw)) {
    return { ok: false, reason: `${label} must not include credentials, tokens, or secrets.` };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "::1") {
    return { ok: false, reason: `${label} must be a public host, not localhost.` };
  }
  return { ok: true, url: parsed.toString() };
}

function parseEvidenceFileNames(raw: string): { ok: true; names: string[] } | { ok: false; reason: string } {
  const names = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const name of names) {
    if (isForbiddenEvidenceFilename(name)) {
      return {
        ok: false,
        reason: "Do not list secret files (.env, keys, credentials). Describe paths in notes instead, without values.",
      };
    }
    const secret = scanTextForSecrets(name);
    if (!secret.ok) return { ok: false, reason: secret.reason };
  }
  return { ok: true, names };
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function readChecked(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return value === true || value === "on" || value === "true" || value === "yes";
}

export function forbiddenIntakeFieldsPresent(source: Record<string, unknown>): string[] {
  return FORBIDDEN_INTAKE_FIELD_NAMES.filter((name) => Object.prototype.hasOwnProperty.call(source, name));
}

export function parseRescueIntake(source: Record<string, unknown>): IntakeParseResult {
  const forbidden = forbiddenIntakeFieldsPresent(source);
  if (forbidden.length > 0) {
    return {
      ok: false,
      errors: {},
      formError: "This form does not accept access tokens or secrets. Grant read-only access separately.",
    };
  }

  const errors: IntakeFieldErrors = {};
  const contactName = readString(source, "contactName");
  const workEmail = readString(source, "workEmail");
  const repositoryUrl = readString(source, "repositoryUrl");
  const appTypeRaw = readString(source, "appType");
  const criticalWorkflow = readString(source, "criticalWorkflow");
  const deploymentUrlRaw = readString(source, "deploymentUrl");
  const accessGrantMethodRaw = readString(source, "accessGrantMethod");
  const evidenceNotes = readString(source, "evidenceNotes");
  const evidenceFileNamesRaw = readString(source, "evidenceFileNames");

  const nameParsed = nameSchema.safeParse(contactName);
  if (!nameParsed.success) errors.contactName = "Enter a name.";
  else {
    const secret = scanTextForSecrets(nameParsed.data);
    if (!secret.ok) errors.contactName = secret.reason;
  }

  const emailParsed = emailSchema.safeParse(workEmail.trim().toLowerCase());
  if (!emailParsed.success) errors.workEmail = "Enter a work email.";
  else {
    const secret = scanTextForSecrets(emailParsed.data);
    if (!secret.ok) errors.workEmail = secret.reason;
  }

  const repoParsed = parsePublicHttpsUrl(repositoryUrl, "Repository URL");
  if (!repoParsed.ok) errors.repositoryUrl = repoParsed.reason;
  else {
    const secret = scanTextForSecrets(repoParsed.url);
    if (!secret.ok) errors.repositoryUrl = secret.reason;
  }

  const appParsed = z.enum(APP_TYPES).safeParse(appTypeRaw);
  if (!appParsed.success) errors.appType = "Choose the web application type.";

  const workflowParsed = workflowSchema.safeParse(criticalWorkflow);
  if (!workflowParsed.success) errors.criticalWorkflow = "Describe one critical workflow in at least a sentence.";
  else {
    const secret = scanTextForSecrets(workflowParsed.data);
    if (!secret.ok) errors.criticalWorkflow = secret.reason;
  }

  let deploymentUrl: string | null = null;
  if (deploymentUrlRaw.trim()) {
    const deployParsed = parsePublicHttpsUrl(deploymentUrlRaw, "Deployment URL");
    if (!deployParsed.ok) errors.deploymentUrl = deployParsed.reason;
    else deploymentUrl = deployParsed.url;
  }

  const accessParsed = z.enum(ACCESS_GRANT_METHODS).safeParse(accessGrantMethodRaw);
  if (!accessParsed.success) errors.accessGrantMethod = "Choose how you will grant read-only access.";

  const notesParsed = notesSchema.safeParse(evidenceNotes);
  if (!notesParsed.success) errors.evidenceNotes = "Evidence notes must be under 2,000 characters.";
  else {
    const secret = scanTextForSecrets(notesParsed.data);
    if (!secret.ok) errors.evidenceNotes = secret.reason;
  }

  const filesParsed = parseEvidenceFileNames(evidenceFileNamesRaw);
  if (!filesParsed.ok) errors.evidenceFileNames = filesParsed.reason;

  const acknowledgements = [
    "acknowledgedNotPenTest",
    "acknowledgedNotCompliance",
    "acknowledgedNoGuarantee",
    "acknowledgedSingleScope",
    "acknowledgedPointInTime",
    "acknowledgedNoSecretsSubmitted",
  ];
  if (!acknowledgements.every((key) => readChecked(source, key))) {
    errors.acknowledgements = "Confirm each limitation before submitting.";
  }

  if (
    Object.keys(errors).length > 0 ||
    !nameParsed.success ||
    !emailParsed.success ||
    !repoParsed.ok ||
    !appParsed.success ||
    !workflowParsed.success ||
    !accessParsed.success ||
    !notesParsed.success ||
    !filesParsed.ok
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    intake: {
      contactName: nameParsed.data,
      workEmail: emailParsed.data,
      repositoryUrl: repoParsed.url,
      appType: appParsed.data,
      criticalWorkflow: workflowParsed.data,
      deploymentUrl,
      accessGrantMethod: accessParsed.data,
      aiAssistedOptIn: readChecked(source, "aiAssistedOptIn"),
      evidenceNotes: notesParsed.data,
      evidenceFileNames: filesParsed.names,
      remediationInterest: readChecked(source, "remediationInterest"),
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
