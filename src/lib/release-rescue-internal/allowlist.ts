import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  applicationScopeSchema,
  branchNameSchema,
  criticalWorkflowScopeSchema,
  repositoryRefSchema,
} from "@/lib/release-rescue-intake";

// The repositories the internal workflow may read, and the one application and
// one critical workflow each review covers.
//
// A repository that is not on this list is refused before anything touches it.
// The list is committed, so adding a target is meant to be a reviewed change
// rather than a value typed into a form. The file is read from the working
// directory, and nothing here checks that it is committed: an uncommitted edit
// takes effect. What this does rule out is a run read against some other file,
// outside the test harness (`allowlistPath`).

export const ALLOWLIST_SCHEMA_VERSION = "release-rescue-internal-allowlist/v1" as const;

export const DEFAULT_ALLOWLIST_PATH = "config/release-rescue-internal.allowlist.json";

export const allowlistEntrySchema = z
  .object({
    repositoryRef: repositoryRefSchema,
    defaultBranch: branchNameSchema,
    application: applicationScopeSchema,
    criticalWorkflow: criticalWorkflowScopeSchema,
  })
  .strict();

export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export const allowlistSchema = z
  .object({
    schemaVersion: z.literal(ALLOWLIST_SCHEMA_VERSION),
    repositories: z.array(allowlistEntrySchema).min(1).max(50),
  })
  .strict()
  .refine(
    (list) => new Set(list.repositories.map((entry) => entry.repositoryRef.toLowerCase())).size === list.repositories.length,
    "a repository may appear on the allowlist once",
  );

export type Allowlist = z.infer<typeof allowlistSchema>;

/** Names another allowlist file, for the test harness only: see `allowlistPath`. */
export const ALLOWLIST_OVERRIDE_ENV = "RELEASE_RESCUE_ALLOWLIST";
/** Marks a test-harness process. Nothing in normal use sets it, and the docs say not to. */
export const TEST_FIXTURES_ENV = "RELEASE_RESCUE_TEST_FIXTURES";

/**
 * The allowlist file a run reads: the committed one, always, outside the test
 * harness.
 *
 * `RELEASE_RESCUE_ALLOWLIST` lets the unit and browser tests point a real
 * process at a fixture list. It used to be honoured in every run, so an
 * operator could put an unreviewed repository in a temporary file and sign a
 * report on it without the committed change that is the authorization step.
 * It is now read only when `RELEASE_RESCUE_TEST_FIXTURES=1` is also set, and
 * otherwise ignored, so the run is refused as not allowlisted rather than
 * quietly read against another list.
 */
export function allowlistPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env[ALLOWLIST_OVERRIDE_ENV];
  return override !== undefined && env[TEST_FIXTURES_ENV] === "1" ? override : DEFAULT_ALLOWLIST_PATH;
}

export function loadAllowlist(path: string = allowlistPath()): Allowlist {
  // Not traced into a server bundle: the allowlist is read from the working
  // directory of a local process, never shipped with a deployment.
  const raw = JSON.parse(readFileSync(resolve(/* turbopackIgnore: true */ process.cwd(), path), "utf8"));
  return allowlistSchema.parse(raw);
}

/**
 * The allowlisted entry for a repository reference, or null.
 *
 * Compared case-insensitively, because GitHub treats `owner/name` that way and
 * a case difference must not be a way to name a repository twice.
 */
export function findAllowlisted(allowlist: Allowlist, repositoryRef: string): AllowlistEntry | null {
  const wanted = repositoryRef.trim().toLowerCase();
  return allowlist.repositories.find((entry) => entry.repositoryRef.toLowerCase() === wanted) ?? null;
}

/**
 * `owner/name` from a git remote URL, or null when it is not a GitHub remote.
 *
 * Used to confirm a local checkout really is a clone of the allowlisted
 * repository, so a checkout path cannot quietly point the review at a
 * different codebase. Credentials in the URL are never returned.
 */
export function githubRefFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  const patterns = [
    /^https:\/\/(?:[^@/]+@)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}
