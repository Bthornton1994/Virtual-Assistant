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
export const CREDENTIAL_QUALIFIERS = [
  "auth", "authorization", "api", "access", "private", "client", "session", "signing",
  "encryption", "master", "shared", "account", "security", "refresh", "bearer", "oauth",
  "service", "app", "admin", "root", "db", "database", "smtp", "mail", "ftp", "ssh", "registry",
  // Vendor and product qualifiers. These are what real credential variables are
  // named after, and leaving them out is what made `PGPASSWORD` — libpq's own —
  // invisible while `PG_PASSWORD` was evidence.
  "pg", "postgres", "postgresql", "mysql", "mariadb", "mongo", "mongodb", "redis", "rabbit",
  "npm", "github", "gitlab", "bitbucket", "slack", "stripe", "twilio", "sendgrid", "aws",
  "azure", "gcp", "docker", "vault", "jwt", "bot", "user", "id", "bind", "ldap", "sso", "saml",
] as const;

export const CREDENTIAL_CARRIERS = [
  "key", "keys", "token", "tokens", "secret", "secrets", "header", "credential", "credentials",
  "password", "passwords", "passphrase", "pass", "pw", "signature",
  "pwd", "pwds", "psw", "pword", "passcode", "auth",
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
  return segments.some(runTogetherLooksSecret);
}

/**
 * Whether a run-together segment names a credential.
 *
 * `keyNameSegments` splits on separators and camel-case boundaries, so a name
 * with neither arrives as one segment no lexicon lookup can match. `PGPASSWORD`
 * was invisible while `PG_PASSWORD` was credential evidence.
 *
 * The first attempt at this was a hand-written list of words to look for as
 * SUBSTRINGS, and it was wrong in both directions at once. It missed the entire
 * token family — `ACCESSTOKEN`, `GITHUBTOKEN`, `SESSIONTOKEN`, `MYSQLPWD` —
 * because nobody had typed those words into it. And because `secret` is a
 * substring of `secretary`, it made `SECRETARY_EMAIL`, `PASSWORDLESS_LOGIN` and
 * `CREDENTIALING_VENDOR` into confident credential evidence, which is an
 * unclearable hold on a plausible line of auth code.
 *
 * So this derives from the lexicon that already exists rather than adding a
 * second one beside it. Two rules, both anchored at the END of the segment,
 * which is what makes `secretary` and `passwordless` fail: a credential name
 * ends with what it holds.
 */
function runTogetherLooksSecret(segment: string): boolean {
  // A segment that the ordinary lookups already handle is not this function's.
  // Four, not five: `DBPW`, `PGPW` and `IDPW` are four characters and are all
  // real. Found by the qualifier x carrier product below, which is what that
  // product is for — a floor picked by eye excludes whatever sits just under it.
  if (segment.length < 4 || SECRET_KEY_WORDS.has(segment)) return false;

  // 1. `<qualifier><carrier>`: the same product that generates the separated
  //    phrases, concatenated. `access` + `token`, `mysql` + `pwd`, `bind` + `pw`.
  //    `bypass` does not match, because `by` is not a qualifier — which is the
  //    whole reason the split is anchored rather than free.
  for (const carrier of CREDENTIAL_CARRIERS) {
    if (!segment.endsWith(carrier)) continue;
    const prefix = segment.slice(0, -carrier.length);
    if (prefix.length > 0 && (CREDENTIAL_QUALIFIERS as readonly string[]).includes(prefix)) {
      return true;
    }
  }

  // 2. A long carrier word at the end, with any prefix at all. Six characters is
  //    the floor because the short ones (`pw`, `key`, `pass`) are exactly the
  //    ones that end ordinary English words, and rule 1 already covers those
  //    with a known qualifier in front.
  return LONG_CARRIER_WORDS.some(
    (word) => segment.length > word.length && segment.endsWith(word),
  );
}

/**
 * Carrier words long enough that a name ending in one is a credential whatever
 * precedes it. Short carriers are deliberately absent: see rule 2 above.
 */
const LONG_CARRIER_WORDS: readonly string[] = [
  "password", "passwords", "passwd", "passphrase", "passcode", "secret", "secrets",
  "credential", "credentials", "apikey", "accesskey", "secretkey", "privatekey",
  "authtoken", "clientsecret", "connectionstring",
];


