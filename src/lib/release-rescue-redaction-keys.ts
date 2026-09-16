// Whether a key NAME claims to hold a credential.
//
// Its own module because both the detector table and the assignment scanner need
// it, and because it is the one part of this area that has survived every audit
// unchanged. The property it encodes: a name is credential-shaped if any of its
// SEGMENTS names a secret. Prefixes, suffixes, infixes, casing and separator
// style are all irrelevant, which is why none of them appears here.
//
// Segments, never substrings. A substring match would make "bypass" a password
// and "tokenizer" a token.
//
// A fourth audit showed that reasoning had been applied inconsistently. `pass`
// and `pw` were confined to a "whole key only" set, and the stated reason was
// the very false positive that SEGMENT matching already prevents:
// `keyNameSegments("bypass")` is `["bypass"]`, which never equals `"pass"`. So
// the restriction bought nothing and cost `DB_PASS`, `SMTP_PASS` and `ADMIN_PW`
// — some of the most common credential variable names there are.
//
// The lesson generalises past those three names: this list must be closed under
// the ABBREVIATIONS people actually type, not just the full words, and every
// entry must be reachable in every affix position. `release-rescue-scanner`
// tests generate the cross product rather than listing examples.

/**
 * Key-name segments that name a credential on their own.
 *
 * Matched as whole segments, never as substrings: "tokenizer" is not "token",
 * and "bypass" is not "pass". A substring match here would hard-fail reports
 * over ordinary prose, and this scanner blocks delivery when it fires.
 */
const SECRET_KEY_WORDS: ReadonlySet<string> = new Set([
  // Full words.
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
  // Abbreviations. Each one is a segment, so `bypass` and `compass` are still
  // untouched; only a name that has `pass` as its OWN part matches.
  "pass",
  "passes",
  "pw",
  "pwds",
  "psw",
  "pword",
  "secrets",
  "sec",
  "tok",
  "apikeys",
  "apisecret",
  "accesskey",
  "secretkey",
  "privkey",
  "authtoken",
  "sessionkey",
  "signingkey",
  "clientsecret",
  "connectionstring",
  "cert",
  "certs",
  "keystore",
  "keyfile",
  "pem",
  "pgpass",
  // Credential nouns that are not password-shaped words. `PIN=4821` was missed
  // because the classification was right and the LEXICON did not contain "pin".
  // Each is a whole segment, so `pinned`, `spin` and `seeded` are untouched.
  "pin",
  "pins",
  "passcode",
  "passcodes",
  "otp",
  "totp",
  "mnemonic",
  "seedphrase",
  "recoverycode",
  "accesscode",
  "authcode",
  "securitycode",
]);

/**
 * Key names that are credential-shaped only when they are the WHOLE name.
 *
 * `key` and `auth` stay here: `cacheKey`, `sortKey` and `authProvider` are
 * ordinary and common. `pass` and `pw` moved OUT of this set into the segment
 * list above, because a segment match already distinguishes them from `bypass`.
 */
const SECRET_WHOLE_KEYS: ReadonlySet<string> = new Set(["key", "keys", "auth", "pat", "pk"]);

/**
 * Adjacent segment pairs that name a credential together but not apart.
 *
 * GENERATED from a qualifier set and a carrier set rather than listed, because
 * listing them is how `AUTH_HEADER` was missed: `auth` alone is too broad
 * (`authProvider`), `header` alone is meaningless, and the pair is obvious — it
 * was simply not one of the pairs somebody had typed out.
 *
 * The cross product is the property: any qualifier that narrows WHOSE credential
 * it is, next to any carrier that names WHAT the credential is, is a credential.
 * Adding a qualifier covers it against every carrier at once, and the generated
 * tests exercise the whole product.
 */
const CREDENTIAL_QUALIFIERS = [
  "auth", "authorization", "api", "access", "private", "client", "session", "signing",
  "encryption", "master", "shared", "account", "security", "refresh", "bearer", "oauth",
  "service", "app", "admin", "root", "db", "database", "smtp", "mail", "ftp", "ssh", "registry",
] as const;

const CREDENTIAL_CARRIERS = [
  "key", "keys", "token", "tokens", "secret", "secrets", "header", "credential", "credentials",
  "password", "passwords", "passphrase", "pass", "pw", "signature",
] as const;

const SECRET_KEY_PHRASES: ReadonlySet<string> = new Set([
  ...CREDENTIAL_QUALIFIERS.flatMap((qualifier) =>
    CREDENTIAL_CARRIERS.map((carrier) => `${qualifier} ${carrier}`),
  ),
  // Pairs that are credentials without fitting the qualifier/carrier shape.
  "service role",
  "connection string",
  "service account",
  "identified by",
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
  // Bounded by TRUNCATION, not by refusal.
  //
  // Returning nothing for a long key was an evasion: 470 characters of padding
  // in front of `DB_PASSWORD` produced one enormous token, which exceeded the cap
  // and therefore looked like no credential at all. An end-to-end test on a
  // truncated excerpt found it. The cap exists to bound the camel-case regexes,
  // so taking the TAIL keeps that bound while leaving the meaningful part of the
  // name — which is at the end — intact.
  const bounded = key.length > MAX_KEY_NAME_LENGTH ? key.slice(-MAX_KEY_NAME_LENGTH) : key;
  return bounded
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{1,64})([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase())
    // A trailing digit run is an instance marker, not a different word:
    // PASSWORD1, KEY2, TOKEN_V3 all name the same thing as their undigited form.
    // Found by the generated prefix x suffix x casing matrix, where `PASSWORD_1`
    // in camel case becomes `password1` and stopped matching.
    .map((segment) => (/^[a-z]+[0-9]+$/.test(segment) ? segment.replace(/[0-9]+$/, "") : segment));
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
  return segments.some(containsRunTogetherSecretWord);
}

/**
 * Words long enough to be recognised INSIDE a run-together name.
 *
 * `keyNameSegments` splits on separators and on camel-case boundaries, so a name
 * with neither reduces to one segment that no lexicon lookup can match.
 * `PGPASSWORD` — libpq's own variable, and what psql, pg_dump, Docker entrypoints
 * and CI migration steps read — segmented to `["pgpassword"]` and was invisible,
 * while `PG_PASSWORD` was credential evidence. So were `DBPASSWORD`,
 * `MYSQLPASSWORD`, `ROOTPASSWORD`, `SMTPPASSWORD` and `APPSECRET`.
 *
 * The audit that found this named the axis both scanner test tables pin: every
 * key they use is already a lexicon word or already splits correctly.
 *
 * Only words of six characters or more, and only ones whose letters do not
 * ordinarily occur inside other English words. `pass` is excluded and stays out:
 * it would make `bypass`, `passage` and `compass` credential names.
 */
const RUN_TOGETHER_SECRET_WORDS: readonly string[] = [
  "password", "passwd", "passphrase", "secret", "apikey", "authtoken", "accesskey",
  "privatekey", "secretkey", "credential", "passcode", "bearertoken", "clientsecret",
];

function containsRunTogetherSecretWord(segment: string): boolean {
  // Only for segments the lexicon did not already recognise on its own, and only
  // for run-together names: a segment that IS one of these words is handled above.
  if (segment.length < 8) return false;
  return RUN_TOGETHER_SECRET_WORDS.some(
    (word) => segment.length > word.length && segment.includes(word),
  );
}

