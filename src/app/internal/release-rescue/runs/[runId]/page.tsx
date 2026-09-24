import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Label } from "@/components/ui";
import { ReportView } from "@/components/ai-app-release-rescue/report-view";
import { WithheldView } from "@/components/ai-app-release-rescue/withheld-view";
import { CheckLedger, DraftReview } from "@/components/release-rescue-internal/draft-review";
import { signInternalRunAction } from "@/app/actions/release-rescue-internal";
import { REVIEW_DECISION_REASON_CATALOG, REVIEW_DECISION_REASON_CODES } from "@/lib/release-rescue-observation-catalog";
import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
import { INTERNAL_PATH, requireOperator } from "@/lib/release-rescue-internal/request-guard";
import { deliveryForRun } from "@/lib/release-rescue-internal/review";
import { isRunId, loadRun, sealIntact, sweepRetention } from "@/lib/release-rescue-internal/store";
import { modelAnalysisReason } from "@/lib/release-rescue-internal/summary";

const REFUSALS: Record<string, string> = {
  draft_tampered: "The stored draft no longer matches its seal, so it cannot be signed.",
  content_changed_since_shown: "The report changed after it was shown to you. Read it again and sign what is shown now.",
  malformed_submission: "The signature request was malformed. It may carry a reason and the content hash, and nothing else.",
  operator_unknown: "You are not a registered reviewer.",
  not_awaiting_review: "This run has no draft awaiting review.",
  signature_refused: "The signature was refused by the report validator.",
  ownership_not_confirmed: "Confirm the repository is ours before signing a run started from the terminal.",
  run_not_found: "No such run.",
};

export default async function InternalRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ refused?: string; view?: string }>;
}) {
  const operator = await requireOperator();
  const { runId } = await params;
  if (!isRunId(runId)) notFound();
  sweepRetention();
  const record = loadRun(runId);
  if (!record) notFound();
  const { refused, view } = await searchParams;

  const draftIntact = record.draft ? sealIntact("draft", runId, record.draft) : false;
  const delivery = record.status === "signed" ? deliveryForRun(runId) : null;
  const base = `${INTERNAL_PATH}/runs/${runId}`;

  return (
    <div className="space-y-10">
      <p className="text-sm">
        <Link className="underline underline-offset-4" href={INTERNAL_PATH}>
          All runs
        </Link>
      </p>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{record.repositoryRef}</h1>
          <Badge tone={record.status === "signed" ? "good" : record.status === "blocked" ? "bad" : record.status === "purged" ? "neutral" : "warn"}>
            {record.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="text-sm text-ink-soft">
          {record.applicationName}: {record.workflowName}. Commit{" "}
          <span className="font-mono">{record.commitSha ?? "not pinned"}</span>, read from{" "}
          {record.source === "git_objects" ? "the local clone's object database" : "a local archive"}. Started{" "}
          {record.createdAt} by {record.createdBy.displayName}. Retention: {record.retentionPolicy}.
        </p>
      </header>

      {refused ? (
        <p className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {REFUSALS[refused] ?? "The request was refused."}
        </p>
      ) : null}

      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">Source acquisition: {record.acquisition.status.toUpperCase()}</h2>
        <p className="text-sm text-ink-soft">
          {record.acquisition.totals.acceptedFileCount} files read ({record.acquisition.totals.acceptedBytes} bytes),{" "}
          {record.acquisition.totals.rejectedCount} entries not read, {record.acquisition.totals.streamBytes} bytes
          received in total. Limits are enforced on the bytes actually read.
        </p>
        {Object.keys(record.acquisition.rejectedByReason).length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {Object.entries(record.acquisition.rejectedByReason).map(([reason, count]) => (
              <li key={reason}>
                {reason}: {count}
              </li>
            ))}
          </ul>
        ) : null}
        {record.processingFailure ? (
          <p className="text-sm text-bad">BLOCKED: {record.processingFailure.message}</p>
        ) : null}
        {record.acquisition.refusals.map((refusal) => (
          <p key={refusal.reason} className="text-sm text-bad">
            BLOCKED ({refusal.reason}): {refusal.detail}
          </p>
        ))}
        {record.notes ? (
          <p className="text-sm text-ink-soft">
            Every accepted file was scanned: {record.notes.utf16FilesDecoded} as decoded UTF-16 text, and{" "}
            {record.notes.binaryFilesScannedAsBytes} binary files as bytes, for distinctive credential shapes only and
            with no line numbers.{" "}
            {Object.entries(record.notes.reviewerCandidatesByDetector).length > 0
              ? `Generic detector matches left for you, counted and not reported: ${Object.entries(
                  record.notes.reviewerCandidatesByDetector,
                )
                  .map(([detector, count]) => `${detector} ${count}`)
                  .join(", ")}.`
              : "No generic detector matches."}
          </p>
        ) : null}
        <p className="text-sm text-ink-soft">
          Model-assisted analysis: NOT RUN. {modelAnalysisReason(record)}
        </p>
      </Card>

      {record.checkRuns.length > 0 ? <CheckLedger checkRuns={record.checkRuns} /> : null}

      {record.status === "purged" ? (
        <p className="text-sm text-ink-soft">
          Purged at {record.purgedAt} under its retention policy. The accounting record keeps the hashes (subject{" "}
          <span className="font-mono text-xs">{record.accounting.subjectHash}</span>) and the verdict (
          {record.accounting.verdict}), and none of the report.
        </p>
      ) : null}

      {record.status === "awaiting_review" && record.draft ? (
        draftIntact ? (
          <>
            <DraftReview report={record.draft.report} subjectHash={hashReleaseRescueReviewSubject(record.draft.report)} />
            <p className="text-xs text-ink-soft">
              The limitation about an AI system is carried on every report by the product. This run used no model.
            </p>
            <Card className="space-y-4 p-4">
              <h2 className="font-semibold">Sign this report</h2>
              <p className="text-sm text-ink-soft">
                You are signed in as <strong>{operator.displayName}</strong>. Your signature records your name, the time,
                the reason you choose, and the content hash above. If the stored report changes before you submit, the
                signature is refused.
              </p>
              <form action={signInternalRunAction} className="space-y-3">
                <input type="hidden" name="runId" value={runId} />
                <input
                  type="hidden"
                  name="approvedContentHash"
                  value={hashReleaseRescueReviewSubject(record.draft.report)}
                />
                <div>
                  <Label htmlFor="reasonCode">Why you are releasing it</Label>
                  <select
                    id="reasonCode"
                    name="reasonCode"
                    required
                    className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-sm"
                  >
                    {REVIEW_DECISION_REASON_CODES.map((code) => (
                      <option key={code} value={code}>
                        {REVIEW_DECISION_REASON_CATALOG[code]}
                      </option>
                    ))}
                  </select>
                </div>
                {record.ownershipConfirmedBy.operatorId === null ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="ownershipConfirmed" value="yes" required className="mt-1" />
                    <span>
                      This run was started from the terminal, so nobody has confirmed it by name: this repository is
                      ours, and I am authorized to review it.
                    </span>
                  </label>
                ) : null}
                <Button type="submit">Sign as {operator.displayName}</Button>
              </form>
            </Card>
          </>
        ) : (
          <p className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
            TAMPERED: the stored draft no longer matches its seal. It is not shown and cannot be signed. Start a new run.
          </p>
        )
      ) : null}

      {delivery ? (
        delivery.status === "deliverable" ? (
          <ReportView
            report={delivery.decision.view}
            contentHash={delivery.decision.contentHash}
            reviewer={delivery.decision.reviewer}
            checks={delivery.decision.checks}
            view={view === "json" ? "json" : "readable"}
            synthetic={false}
            links={{ readable: base, json: `${base}?view=json`, download: `${base}/export` }}
          />
        ) : (
          <WithheldView blockers={delivery.blockers} contentHash={record.signed?.reportHash ?? ""} />
        )
      ) : null}
    </div>
  );
}
