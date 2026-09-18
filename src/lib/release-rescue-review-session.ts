import { z } from "zod";
import { MANAGER_ROLES, type Actor } from "@/lib/domain";
import { REVIEW_DECISION_REASON_CODES } from "@/lib/release-rescue-observation-catalog";
import {
  signReleaseRescueReport,
  type ReleaseRescueReportV1,
  type ReviewAttestation,
} from "@/lib/release-rescue-report";

// The reviewer is whoever is signed in. Nothing else.
//
// `signReleaseRescueReport` takes a complete `ReviewAttestation`, identity
// included, and verifies everything about it except WHO is asking. That is the
// right shape for the function — it is also what the database's server-role
// path needs, where the server has already authenticated the operator — and the
// wrong shape for a request handler, which would be trusting a form field to
// say who the reviewer is.
//
// So an interactive signing goes through here. What the reviewer's console may
// submit is the decision: a reason code and the hash of what they read. Who they
// are comes from the session the framework authenticated, and when they signed
// comes from the server clock. A submission that tries to carry an identity is
// refused as malformed rather than ignored, so a client built against the wrong
// contract finds out.
//
// The database enforces the same rule from its side: an interactive INSERT on
// release_rescue_reports must name `auth.uid()` as `reviewed_by`, and an
// interactive report artifact must name `auth.uid()` in its signature. This
// module is the application half of that, not a substitute for it.

/** What a reviewer's console submits. Identity is not a field here, by design. */
export const reviewSubmissionSchema = z
  .object({
    reasonCode: z.enum(REVIEW_DECISION_REASON_CODES),
    approvedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export type AuthenticatedReviewer = {
  readonly operatorUserId: string;
  readonly displayName: string;
};

export class ReviewerNotAuthorizedError extends Error {
  constructor(message: string) {
    super(`Release Rescue review: ${message}`);
    this.name = "ReviewerNotAuthorizedError";
  }
}

export class ReviewSubmissionError extends Error {
  constructor(message: string) {
    super(`Release Rescue review: ${message}`);
    this.name = "ReviewSubmissionError";
  }
}

/**
 * The reviewer, read from the authenticated session and from nowhere else.
 *
 * A demo-source actor is the sample workspace's cookie login. It is a real
 * `Actor` for rendering purposes and not an authenticated person, so it cannot
 * sign anything a customer pays for.
 */
export function authenticatedReviewerFrom(actor: Actor): AuthenticatedReviewer {
  if (actor.source !== "supabase") {
    throw new ReviewerNotAuthorizedError(
      "signing a report requires an authenticated operator session; a demo session cannot sign.",
    );
  }
  if (!MANAGER_ROLES.includes(actor.role)) {
    throw new ReviewerNotAuthorizedError(
      "a report may only be signed by an ops manager or platform admin acting as themselves.",
    );
  }
  if (actor.id.length === 0) {
    throw new ReviewerNotAuthorizedError("the authenticated session carries no user id.");
  }
  return { operatorUserId: actor.id, displayName: actor.name };
}

/**
 * Compose the attestation the signer verifies, from the session and the
 * decision. The two inputs are kept apart on purpose: nothing in `submission`
 * can name or rename the reviewer, and nothing in `actor` is trusted for the
 * decision.
 */
export function attestationFromAuthenticatedReviewer(
  actor: Actor,
  submission: unknown,
  reviewedAt: Date,
): ReviewAttestation {
  const reviewer = authenticatedReviewerFrom(actor);

  const parsed = reviewSubmissionSchema.safeParse(submission);
  if (!parsed.success) {
    // Field names only, never values. A rejected submission may hold anything,
    // and this message reaches logs. An unexpected key is reported by its name,
    // which is the one thing about it a client needs to hear.
    const paths = [
      ...new Set(
        parsed.error.issues.flatMap((issue) =>
          issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".") || "(root)"],
        ),
      ),
    ];
    throw new ReviewSubmissionError(
      `the review submission is malformed at ${paths.join(", ")}. It carries a reason code and the approved content hash, and nothing else; the reviewer's identity is read from the session.`,
    );
  }

  return {
    operatorUserId: reviewer.operatorUserId,
    displayName: reviewer.displayName,
    reviewedAt: reviewedAt.toISOString(),
    reasonCode: parsed.data.reasonCode,
    approvedContentHash: parsed.data.approvedContentHash,
  };
}

/**
 * Sign a report as the authenticated actor. The only interactive route to a
 * signature: `signReleaseRescueReport` remains available to the server path,
 * which supplies an identity it has authenticated by other means.
 */
export function signReleaseRescueReportAs(
  actor: Actor,
  report: ReleaseRescueReportV1,
  submission: unknown,
  reviewedAt: Date = new Date(),
): ReleaseRescueReportV1 {
  return signReleaseRescueReport(report, attestationFromAuthenticatedReviewer(actor, submission, reviewedAt));
}
