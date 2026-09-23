import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { hmacHex, hmacMatches, localDir, readJson, writePrivateJson } from "@/lib/release-rescue-internal/store";

// A real, local identity for the one person allowed to sign an internal report.
//
// The product's reviewer identity is a Supabase session, and
// `authenticatedReviewerFrom` refuses anything else, including the unsigned demo
// cookie. The internal workflow runs with no Supabase at all, so it needs its
// own identity, and it must not be a weaker one in disguise:
//
// - An operator is created only from a terminal, by the person who will sign,
//   who types a passphrase that is stored as a salted scrypt hash and nowhere
//   else. No page can create one, no default one exists, and no test identity
//   is ever written outside a test's own temporary directory.
// - A session is an HMAC-signed cookie keyed by the local secret file, with an
//   expiry. It names an operator id; the operator's name and role are read from
//   the registry on every request, so deleting an operator ends their sessions.
// - The reviewer on a signature is the session's operator. A request can carry
//   a reason code and the hash of what was shown, and nothing that names a
//   person.
//
// This identity is valid only in the local internal mode. It is not an
// `Actor`, it cannot reach any other part of the application, and it grants no
// authority outside `/internal/release-rescue`.

export const OPERATOR_SCHEMA_VERSION = "release-rescue-internal-operators/v1" as const;
export const SESSION_COOKIE = "dc_rr_internal_session";
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const MIN_PASSPHRASE_LENGTH = 12;

const OPERATOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 };

const operatorSchema = z
  .object({
    operatorId: z.string().regex(OPERATOR_ID_PATTERN),
    displayName: z.string().trim().min(2).max(120),
    role: z.literal("ops_manager"),
    passphraseHash: z.string().regex(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/),
    createdAt: z.string(),
    /** Sessions issued before this time (ms) are void. Set by signing out. */
    sessionsValidFrom: z.number().int().nonnegative().optional(),
  })
  .strict();

export type LocalOperator = z.infer<typeof operatorSchema>;

const registrySchema = z
  .object({ schemaVersion: z.literal(OPERATOR_SCHEMA_VERSION), operators: z.array(operatorSchema) })
  .strict();

function registryPath(): string {
  return join(localDir(), "operators.json");
}

export function loadOperators(): LocalOperator[] {
  const raw = readJson<unknown>(registryPath());
  if (raw === null) return [];
  return registrySchema.parse(raw).operators;
}

export function findOperator(operatorId: string): LocalOperator | null {
  return loadOperators().find((operator) => operator.operatorId === operatorId) ?? null;
}

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(passphrase, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The name that will appear on signatures. It is held to the same rules a
 * reviewer's display name is held to at signing, so a registration cannot
 * create a name the signing step would then have to refuse.
 */
export function displayNameProblem(displayName: string): string | null {
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return "A display name must be 2 to 120 characters.";
  if (/[\u0000-\u001f\u007f<>]/.test(trimmed)) return "A display name may not contain control characters or angle brackets.";
  if (findProhibitedClaims(trimmed, "typed_field").length > 0) return "A display name may not make a claim about the review.";
  if (redactSecrets(trimmed).hadSecrets) return "A display name may not look like a credential.";
  return null;
}

/** Adds an operator. Called from the terminal only; see `scripts/release-rescue-local.mjs`. */
export function addOperator(displayName: string, passphrase: string, now: Date = new Date()): LocalOperator {
  const problem = displayNameProblem(displayName);
  if (problem) throw new Error(problem);
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`A passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const operators = loadOperators();
  if (operators.some((operator) => operator.displayName.toLowerCase() === displayName.trim().toLowerCase())) {
    throw new Error("An operator with that display name already exists.");
  }
  const operator: LocalOperator = operatorSchema.parse({
    // A UUID, because that is what a report's `reviewedBy.operatorUserId` is.
    operatorId: randomUUID(),
    displayName: displayName.trim(),
    role: "ops_manager",
    passphraseHash: hashPassphrase(passphrase),
    createdAt: now.toISOString(),
  });
  writePrivateJson(registryPath(), { schemaVersion: OPERATOR_SCHEMA_VERSION, operators: [...operators, operator] });
  return operator;
}

export function removeOperator(operatorId: string): boolean {
  const operators = loadOperators();
  const remaining = operators.filter((operator) => operator.operatorId !== operatorId);
  if (remaining.length === operators.length) return false;
  writePrivateJson(registryPath(), { schemaVersion: OPERATOR_SCHEMA_VERSION, operators: remaining });
  return true;
}

// --- Login throttling ---------------------------------------------------------------

const failures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

export type LoginResult = { ok: true; operator: LocalOperator } | { ok: false; reason: "invalid" | "locked" };

/**
 * Checks a display name and passphrase. The failure is the same whether the
 * name or the passphrase was wrong, and every attempt runs scrypt, so a caller
 * cannot learn which names exist.
 */
export function authenticateOperator(displayName: string, passphrase: string, now: number = Date.now()): LoginResult {
  const key = displayName.trim().toLowerCase();
  const record = failures.get(key);
  if (record && record.lockedUntil > now) return { ok: false, reason: "locked" };

  const operator = loadOperators().find((candidate) => candidate.displayName.toLowerCase() === key) ?? null;
  const decoy = "scrypt$32768$8$1$00000000000000000000000000000000$" + "0".repeat(64);
  const matches = verifyPassphrase(passphrase, operator?.passphraseHash ?? decoy) && operator !== null;
  if (!matches) {
    const count = (record?.count ?? 0) + 1;
    failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? now + LOCKOUT_MS : 0 });
    return { ok: false, reason: "invalid" };
  }
  failures.delete(key);
  return { ok: true, operator };
}

// --- Sessions -----------------------------------------------------------------------

const sessionPayloadSchema = z
  .object({
    v: z.literal(1),
    operatorId: z.string().regex(OPERATOR_ID_PATTERN),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();

export function issueSession(operatorId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      operatorId,
      issuedAt: now,
      expiresAt: now + SESSION_LIFETIME_MS,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${hmacHex("rr-session", payload)}`;
}

/**
 * The operator a session names, or null. Checks the signature in constant
 * time, the expiry, and that the operator still exists.
 */
export function operatorFromSession(token: string | undefined | null, now: number = Date.now()): LocalOperator | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  if (!hmacMatches("rr-session", payload, signature)) return null;
  let parsed: z.infer<typeof sessionPayloadSchema>;
  try {
    parsed = sessionPayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
  if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000) return null;
  const operator = findOperator(parsed.operatorId);
  if (!operator || parsed.issuedAt < (operator.sessionsValidFrom ?? 0)) return null;
  return operator;
}

/**
 * Ends every session this operator holds, including copies of the cookie:
 * sessions issued before now stop verifying. Used by sign-out.
 */
export function endSessions(operatorId: string, now: number = Date.now()): void {
  const operators = loadOperators();
  if (!operators.some((operator) => operator.operatorId === operatorId)) return;
  writePrivateJson(registryPath(), {
    schemaVersion: OPERATOR_SCHEMA_VERSION,
    operators: operators.map((operator) =>
      operator.operatorId === operatorId ? { ...operator, sessionsValidFrom: now + 1 } : operator,
    ),
  });
}
