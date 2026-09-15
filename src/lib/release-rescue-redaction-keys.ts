// Whether a key NAME claims to hold a credential.
//
// Its own module because both the detector table and the assignment scanner need
// it, and because it is the one part of this area that has survived every audit
// unchanged. The property it encodes: a name is credential-shaped if any of its
// SEGMENTS names a secret. Prefixes, suffixes, infixes, casing and separator
// style are all irrelevant, which is why none of them appears here.
//
// Segments, never substrings. A substring match would make "bypass" a password
// and "tokenizer" a token, and over-redaction is not free here: a detected
// credential hard-fails a report, so a false positive blocks a delivery.

/**
 * Key-name segments that name a credential on their own.
 *
 * Matched as whole segments, never as substrings: "tokenizer" is not "token",
 * and "bypass" is not "pass". A substring match here would hard-fail reports
 * over ordinary prose, and this scanner blocks delivery when it fires.
 */
const SECRET_KEY_WORDS: ReadonlySet<string> = new Set([
  "password",
  "passwords",
  "passwd",
  "pwd",
  "passphrase",
  "passphrases",
  "secret",
  "secrets",
  "token",
  "tokens",
  "apikey",
  "apikeys",
  "credential",
  "credentials",
  "creds",
  "authorization",
  "bearer",
  "privatekey",
  "dsn",
  "salt",
]);

/** Key names that are credential-shaped only when they are the WHOLE name. */
const SECRET_WHOLE_KEYS: ReadonlySet<string> = new Set(["key", "keys", "pass", "auth", "pat"]);

/** Adjacent segment pairs that name a credential together but not apart. */
const SECRET_KEY_PHRASES: ReadonlySet<string> = new Set([
  "api key",
  "api keys",
  "access key",
  "access keys",
  "secret key",
  "private key",
  "signing key",
  "encryption key",
  "session key",
  "master key",
  "shared key",
  "account key",
  "security key",
  "auth key",
  "service role",
  "connection string",
  "service account",
]);

/**
 * Splits a key name into lowercase segments on separators AND camel-case
 * boundaries, so `DB_PASSWORD_PROD`, `dbPasswordProd` and `db.password.prod`
 * all reduce to the same three words.
 */
/**
 * The longest key NAME worth considering.
 *
 * A credential key is an identifier, not a document. Without this cap a single
 * enormous token is handed to the camel-case regexes below, and `([A-Z]+)` is
 * greedy: on 80KB of capitals it backtracks from every start position, which is
 * quadratic. The cap is two orders of magnitude above any real environment
 * variable.
 */
export const MAX_KEY_NAME_LENGTH = 200;

export function keyNameSegments(key: string): string[] {
  if (key.length > MAX_KEY_NAME_LENGTH) return [];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{1,64})([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * True when a key name claims to hold a credential, wherever the claim sits.
 *
 * This is the property the detector is really about: a name is secret-shaped if
 * any of its parts names a secret. Prefixes, suffixes, infixes, casing and
 * separator style are all irrelevant, which is why none of them appears here.
 */
export function keyLooksSecret(key: string): boolean {
  const segments = keyNameSegments(key);
  if (segments.length === 0) return false;
  if (segments.length === 1 && SECRET_WHOLE_KEYS.has(segments[0])) return true;
  if (segments.some((segment) => SECRET_KEY_WORDS.has(segment))) return true;
  for (let index = 0; index + 1 < segments.length; index += 1) {
    if (SECRET_KEY_PHRASES.has(`${segments[index]} ${segments[index + 1]}`)) return true;
  }
  return false;
}

