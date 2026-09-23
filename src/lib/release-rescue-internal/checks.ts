import { MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { redactSecrets, type SecretDetectorName } from "@/lib/release-rescue-redaction";
import { composeFinding, repositoryPathSchema, type ReleaseRescueFindingV1 } from "@/lib/release-rescue-findings";
import { RELEASE_RESCUE_RUBRIC_V1, type RubricEvidenceKind } from "@/lib/release-rescue-rubric";
import type { AssessmentRationaleCode } from "@/lib/release-rescue-observation-catalog";
import type { RubricAssessment } from "@/lib/release-rescue-report";
import type { AcquiredSnapshot, RejectedEntry } from "@/lib/release-rescue-internal/snapshot";
import type { EntryRejectionReason } from "@/lib/release-rescue-snapshot-limits";

// The checks the internal workflow actually runs, and an honest account of
// every check it does not.
//
// Only deterministic code runs here. There is no model call and no executor
// judgement: a check either has an implementation that reads the snapshot and
// records structured observations, or it is NOT RUN and says so. The four run
// states are the ledger an operator reads; the report carries the same facts
// as rubric outcomes, mapped so that nothing unrun or merely clean can become
// a `pass`:
//
//   FAIL     the check ran and recorded at least one observation
//            -> `concern`, with the findings that explain it
//   PASS     the check ran over every file it covers and recorded none
//            -> `not_assessed`, because a clean automated result is not
//               evidence that the control holds
//   BLOCKED  the check could not read every file it covers
//            -> `not_assessed`, saying why
//   NOT RUN  there is no automated implementation; it needs a reviewer
//            -> `not_assessed`, saying so
//
// So a report from this workflow is never clean: its verdict is at best
// `conditional_release`, which is what an incomplete review has to say.
//
// Repository content is data. Nothing a file says is interpreted as an
// instruction: the checks match patterns and count lines, and every word of
// the report comes from the catalog, keyed by code.

export const CHECK_RUN_STATUSES = ["PASS", "FAIL", "BLOCKED", "NOT_RUN"] as const;
export type CheckRunStatus = (typeof CHECK_RUN_STATUSES)[number];

export type CheckRun = {
  checkId: string;
  status: CheckRunStatus;
  implementation: "deterministic" | "none";
  /** Files the check read. */
  filesExamined: number;
  /** Files in scope for the check that it could not read. */
  filesNotRead: number;
  /** Observations recorded, before any were grouped into findings. */
  observationCount: number;
  /** Observations in files the report cannot name. Any makes the check BLOCKED rather than PASS. */
  uncitedObservationCount: number;
};

export type AnalysisNotes = {
  /** Files with no text encoding the checks decode, scanned as bytes for distinctive credential shapes only. */
  binaryFilesScannedAsBytes: number;
  /** UTF-16 files, decoded and scanned as text. */
  utf16FilesDecoded: number;
  /**
   * Lines the generic detectors flagged, by detector, left for a reviewer and
   * not reported as findings. Counts only; the text is never kept.
   */
  reviewerCandidatesByDetector: Record<string, number>;
  /** Locations whose path cannot be carried in a report (for example, a space). */
  unrepresentableLocations: number;
  /** Observations beyond the per-check finding cap, counted but not itemised. */
  observationsBeyondCap: number;
  rejectedByReason: Partial<Record<EntryRejectionReason, number>>;
};

export type Analysis = {
  checkRuns: CheckRun[];
  assessments: RubricAssessment[];
  findings: ReleaseRescueFindingV1[];
  notes: AnalysisNotes;
};

/** Checks this workflow implements. Everything else in the rubric is NOT RUN. */
export const IMPLEMENTED_CHECK_IDS = [
  "secrets.no_secrets_in_version_control",
  "secrets.no_secrets_reachable_from_client",
] as const;

/**
 * Rejection reasons that leave a text check unable to say it read everything.
 *
 * A symlink is not among them: its target, if inside the snapshot, is read
 * under its own path. A credential-named file IS: the snapshot deliberately
 * does not read a committed `.env`, so a secrets check cannot say it found none.
 */
const UNREAD_CONTENT_REASONS: ReadonlySet<EntryRejectionReason> = new Set<EntryRejectionReason>([
  "unsupported_entry_type",
  "absolute_path",
  "path_traversal",
  "path_too_long",
  "path_too_deep",
  "illegal_path_character",
  "file_too_large",
  "credential_file_not_read",
  "malformed_entry",
]);

const MAX_FINDINGS_PER_CHECK = 25;
const MAX_LOCATIONS_PER_FINDING = 20;
const MAX_EVIDENCE_PER_ENTRY = 10;

/** `lines` is null-free text; `binary` means its line numbers mean nothing and are not reported. */
type TextFile = { path: string; lines: string[]; binary: boolean };

function isBinary(bytes: Buffer): boolean {
  const probe = bytes.subarray(0, 8192);
  return probe.includes(0);
}

/** "le" or "be" when the bytes are UTF-16 text, by byte-order mark or by the zero-byte pattern of ASCII in UTF-16. */
function utf16Order(bytes: Buffer): "le" | "be" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "be";
  const probe = bytes.subarray(0, 8192 - (Math.min(bytes.length, 8192) % 2));
  if (probe.length < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let index = 0; index < probe.length; index += 2) {
    if (probe[index] === 0) evenZero += 1;
    if (probe[index + 1] === 0) oddZero += 1;
  }
  const pairs = probe.length / 2;
  if (oddZero >= pairs * 0.9 && evenZero === 0) return "le";
  if (evenZero >= pairs * 0.9 && oddZero === 0) return "be";
  return null;
}

/**
 * Every accepted file, as something the checks can scan. Nothing is skipped: a
 * file a check did not read would make its "found nothing" untrue.
 *
 * - Text is split into lines.
 * - UTF-16 text is decoded first, so a credential in it is found at its line.
 * - Anything else with a zero byte is binary. It is scanned as bytes: runs of
 *   printable characters become the "lines", which is enough for a distinctive
 *   credential shape (a provider prefix, a PEM armour line), and its hits carry
 *   no line numbers because there are none.
 */
function toTextFile(path: string, bytes: Buffer, notes: AnalysisNotes): TextFile {
  if (!isBinary(bytes)) return { path, lines: bytes.toString("utf8").split(/\r?\n/), binary: false };
  const order = utf16Order(bytes);
  if (order) {
    notes.utf16FilesDecoded += 1;
    const body = bytes.subarray(bytes[0] === 0xff || bytes[0] === 0xfe ? 2 : 0);
    const even = body.subarray(0, body.length - (body.length % 2));
    const little = order === "le" ? Buffer.from(even) : Buffer.from(even).swap16();
    return { path, lines: little.toString("utf16le").split(/\r?\n/), binary: false };
  }
  notes.binaryFilesScannedAsBytes += 1;
  return { path, lines: bytes.toString("latin1").split(/[^\x20-\x7e]+/).filter((run) => run.length > 0), binary: true };
}

function evidenceKindFor(path: string): RubricEvidenceKind {
  return /\.(?:json|ya?ml|toml|ini|env[\w.-]*|config\.[cm]?[jt]s)$/i.test(path) || /(^|\/)\.env/.test(path)
    ? "configuration_reference"
    : "code_reference";
}

type Hit = { path: string; startLine: number | null; endLine: number | null };

/**
 * Whether a report may name this path: the location schema's path shape, and
 * no credential in the name, which the report validator refuses. A hit in a
 * file that fails this is counted and never silently dropped; see the status
 * rule in `analyzeSnapshot`.
 */
export function isCitablePath(path: string): boolean {
  return repositoryPathSchema.safeParse(path).success && !redactSecrets(path).hadSecrets;
}

/** Groups hits into findings, per file, within the report's bounds. */
function findingsFrom(
  hits: Hit[],
  make: (index: number, locations: Hit[]) => ReleaseRescueFindingV1,
  notes: AnalysisNotes,
): ReleaseRescueFindingV1[] {
  const representable = hits.filter((hit) => {
    const ok = isCitablePath(hit.path);
    if (!ok) notes.unrepresentableLocations += 1;
    return ok;
  });
  const byFile = new Map<string, Hit[]>();
  for (const hit of representable) {
    const list = byFile.get(hit.path) ?? [];
    list.push(hit);
    byFile.set(hit.path, list);
  }
  const groups: Hit[][] = [];
  for (const list of byFile.values()) {
    for (let offset = 0; offset < list.length; offset += MAX_LOCATIONS_PER_FINDING) {
      groups.push(list.slice(offset, offset + MAX_LOCATIONS_PER_FINDING));
    }
  }
  const kept = groups.slice(0, MAX_FINDINGS_PER_CHECK);
  for (const dropped of groups.slice(MAX_FINDINGS_PER_CHECK)) notes.observationsBeyondCap += dropped.length;
  return kept.map((locations, index) => make(index, locations));
}

/**
 * Detectors whose match is a credential's own distinctive shape: a provider
 * prefix, a fixed length, a PEM armour line. On source code these are strong
 * evidence. The generic detectors (an assignment to a credential-named key, a
 * URL with a password, a bearer header) are built to over-redact report prose,
 * and on source they cannot tell `token: string` or a lockfile's `integrity`
 * field from a credential, so their matches are counted for a reviewer rather
 * than reported. On the first three internal targets every match was from the
 * generic `assigned_secret` detector and none from a distinctive one; whether
 * any of those generic matches is a real credential is a reviewer's call, and
 * the counts are on the run so the reviewer knows to make it.
 */
const DISTINCTIVE_DETECTORS: ReadonlySet<SecretDetectorName> = new Set<SecretDetectorName>([
  "pem_private_key",
  "aws_access_key_id",
  "github_token",
  "github_fine_grained_token",
  "slack_token",
  "stripe_key",
  "anthropic_key",
  "openai_key",
  "google_api_key",
  "sendgrid_key",
  "npm_token",
  "json_web_token",
]);

type ScanVerdict = "distinctive" | "candidate" | null;

function classifyText(text: string, notes: AnalysisNotes | null): ScanVerdict {
  const result = redactSecrets(text);
  if (!result.hadSecrets) return null;
  const distinctive = result.detections.some((detection) => DISTINCTIVE_DETECTORS.has(detection.detector));
  if (distinctive && result.classification === "credential_evidence") return "distinctive";
  if (notes) {
    for (const detection of result.detections) {
      notes.reviewerCandidatesByDetector[detection.detector] =
        (notes.reviewerCandidatesByDetector[detection.detector] ?? 0) + 1;
    }
  }
  return "candidate";
}

/**
 * Credential material committed in the snapshot.
 *
 * Every text file is scanned line by line with the same detectors the report
 * pipeline uses, so a hit has a line number. Lines are also scanned in bounded
 * groups, so a multi-line construct (a PEM block) that no single line reveals is
 * still found, and located to the group. Only a distinctive-shape match becomes
 * an observation; see `DISTINCTIVE_DETECTORS`.
 */
function scanForCommittedCredentials(files: TextFile[], notes: AnalysisNotes): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lineHits = new Set<number>();
    // Generic candidates are counted for text only: in binary content they
    // would count bytes, not code a reviewer can read.
    const candidateNotes = file.binary ? null : notes;
    file.lines.forEach((line, index) => {
      for (let offset = 0; offset < Math.max(1, line.length); offset += MAX_SCAN_LENGTH) {
        if (classifyText(line.slice(offset, offset + MAX_SCAN_LENGTH), candidateNotes) === "distinctive") {
          lineHits.add(index + 1);
          break;
        }
      }
    });
    if (file.binary) {
      // One location per binary file, with no line: its "lines" are byte runs.
      if (lineHits.size > 0) hits.push({ path: file.path, startLine: null, endLine: null });
    } else {
      for (const line of [...lineHits].sort((a, b) => a - b)) hits.push({ path: file.path, startLine: line, endLine: line });
    }

    // Multi-line constructs, in groups well under the scanner's bound. Counted
    // candidates are not re-counted here; this pass only looks for what no
    // single line showed.
    let groupStart = 0;
    let groupLength = 0;
    const flush = (endExclusive: number) => {
      if (endExclusive <= groupStart) return;
      const covered = [...lineHits].some((line) => line - 1 >= groupStart && line - 1 < endExclusive);
      if (covered) return;
      if (classifyText(file.lines.slice(groupStart, endExclusive).join("\n"), null) === "distinctive") {
        if (!file.binary) hits.push({ path: file.path, startLine: groupStart + 1, endLine: endExclusive });
        else if (!hits.some((hit) => hit.path === file.path)) hits.push({ path: file.path, startLine: null, endLine: null });
      }
    };
    file.lines.forEach((line, index) => {
      if (groupLength + line.length + 1 > MAX_SCAN_LENGTH / 2 && index > groupStart) {
        flush(index);
        groupStart = index;
        groupLength = 0;
      }
      groupLength += line.length + 1;
    });
    flush(file.lines.length);
  }
  return hits;
}

/**
 * A privileged key given a client-exposed name.
 *
 * Frameworks ship variables with these prefixes to the browser bundle. A
 * variable so named that also says it is a secret, a service role, a private
 * key, a password or an admin key is exposed by construction. The name is the
 * evidence; the value is never read or recorded.
 */
const CLIENT_EXPOSED_PRIVILEGED_NAME =
  /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|GATSBY|PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|PRIVATE|PASSWORD|ADMIN_KEY)[A-Z0-9_]*\b/;

function scanForClientExposedPrivilegedKeys(files: TextFile[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    if (file.binary) {
      if (file.lines.some((line) => CLIENT_EXPOSED_PRIVILEGED_NAME.test(line))) {
        hits.push({ path: file.path, startLine: null, endLine: null });
      }
      continue;
    }
    file.lines.forEach((line, index) => {
      if (CLIENT_EXPOSED_PRIVILEGED_NAME.test(line)) {
        hits.push({ path: file.path, startLine: index + 1, endLine: index + 1 });
      }
    });
  }
  return hits;
}

function evidenceFor(locations: Hit[]) {
  return locations.slice(0, MAX_EVIDENCE_PER_ENTRY).map((location) => ({
    kind: evidenceKindFor(location.path),
    path: location.path,
    startLine: location.startLine,
    endLine: location.endLine,
  }));
}

export function analyzeSnapshot(snapshot: AcquiredSnapshot): Analysis {
  const notes: AnalysisNotes = {
    binaryFilesScannedAsBytes: 0,
    utf16FilesDecoded: 0,
    reviewerCandidatesByDetector: {},
    unrepresentableLocations: 0,
    observationsBeyondCap: 0,
    rejectedByReason: {},
  };
  for (const rejected of snapshot.rejected) {
    notes.rejectedByReason[rejected.reason] = (notes.rejectedByReason[rejected.reason] ?? 0) + 1;
  }
  const unreadForTextChecks = snapshot.rejected.filter((entry: RejectedEntry) => UNREAD_CONTENT_REASONS.has(entry.reason)).length;

  const textFiles: TextFile[] = [];
  for (const file of snapshot.files) textFiles.push(toTextFile(file.path, file.bytes, notes));

  let findingSequence = 0;
  const nextId = () => `RR-${String((findingSequence += 1)).padStart(3, "0")}`;

  const credentialHits = scanForCommittedCredentials(textFiles, notes);
  const credentialFindings = findingsFrom(
    credentialHits,
    (_index, locations) =>
      composeFinding({
        findingId: nextId(),
        observationCode: "secrets.literal_credential_in_repository",
        // Not `confirmed`: a detector match cannot tell a live key from a
        // revoked one or a test fixture, and only a person can. `likely` caps
        // severity at high and keeps it out of the blocking gate.
        confidence: "likely",
        remediationCode: "rotate_and_move_to_secret_store",
        locations: locations.map(({ path, startLine, endLine }) => ({ path, startLine, endLine })),
        evidence: evidenceFor(locations),
        uncertaintyCode: "static_read_only_no_runtime_confirmation",
      }),
    notes,
  );

  const clientHits = scanForClientExposedPrivilegedKeys(textFiles);
  const clientFindings = findingsFrom(
    clientHits,
    (_index, locations) =>
      composeFinding({
        findingId: nextId(),
        observationCode: "secrets.privileged_key_reaches_the_client",
        // The name is the only evidence, so this is `possible`: whether the
        // variable is set, and to what, depends on the deployment.
        confidence: "possible",
        remediationCode: "move_privileged_call_server_side",
        locations: locations.map(({ path, startLine, endLine }) => ({ path, startLine, endLine })),
        evidence: evidenceFor(locations),
        uncertaintyCode: "behaviour_depends_on_deployment_settings",
      }),
    notes,
  );

  const implemented = new Map<string, { hits: Hit[]; findings: ReleaseRescueFindingV1[] }>([
    ["secrets.no_secrets_in_version_control", { hits: credentialHits, findings: credentialFindings }],
    ["secrets.no_secrets_reachable_from_client", { hits: clientHits, findings: clientFindings }],
  ]);

  const checkRuns: CheckRun[] = [];
  const assessments: RubricAssessment[] = [];
  for (const check of RELEASE_RESCUE_RUBRIC_V1) {
    const result = implemented.get(check.id);
    if (!result) {
      checkRuns.push({
        checkId: check.id,
        status: "NOT_RUN",
        implementation: "none",
        filesExamined: 0,
        filesNotRead: 0,
        observationCount: 0,
        uncitedObservationCount: 0,
      });
      assessments.push({
        checkId: check.id,
        outcome: "not_assessed",
        rationaleCode: "not_assessed_requires_a_reviewers_reading",
        evidence: [],
      });
      continue;
    }

    // A hit is never lost: with a citable finding the check FAILs; with hits it
    // cannot cite, it is BLOCKED rather than "found nothing".
    const uncitedHits = result.hits.filter((hit) => !isCitablePath(hit.path)).length;
    const status: CheckRunStatus =
      result.findings.length > 0 ? "FAIL" : uncitedHits > 0 || unreadForTextChecks > 0 ? "BLOCKED" : "PASS";
    checkRuns.push({
      checkId: check.id,
      status,
      implementation: "deterministic",
      filesExamined: textFiles.length,
      filesNotRead: unreadForTextChecks,
      observationCount: result.hits.length,
      uncitedObservationCount: uncitedHits,
    });

    const rationale: AssessmentRationaleCode =
      status === "FAIL"
        ? "partial_control_with_a_gap"
        : status === "BLOCKED"
          ? uncitedHits > 0
            ? "not_assessed_automated_check_found_instances_it_cannot_cite"
            : "not_assessed_automated_check_could_not_read_everything"
          : "not_assessed_automated_check_found_no_instance";
    assessments.push({
      checkId: check.id,
      outcome: status === "FAIL" ? "concern" : "not_assessed",
      rationaleCode: rationale,
      evidence:
        status === "FAIL"
          ? evidenceFor(result.findings.flatMap((finding) => finding.locations)).slice(0, MAX_EVIDENCE_PER_ENTRY)
          : [],
    });
  }

  return { checkRuns, assessments, findings: [...credentialFindings, ...clientFindings], notes };
}
