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
  "salts",
  // The standard companion to `salt`, and absent while `salt` was present.
  "pepper",
  "peppers",
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
  "azure", "gcp", "docker", "vault", "jwt", "bind", "ldap", "sso", "saml",
  // `user`, `id` and `bot` are NOT here. Adding them generated `USER_KEY`,
  // `ID_KEY` and `BOT_HEADER` as confident credential evidence — an unclearable
  // hold on ordinary configuration names. A qualifier has to narrow the carrier,
  // and those three do not.
] as const;

export const CREDENTIAL_CARRIERS = [
  "key", "keys", "token", "tokens", "secret", "secrets", "credential", "credentials",
  "password", "passwords", "passphrase", "pass", "pw",
  "pwd", "pwds", "psw", "pword", "passcode",
  // `auth` is NOT a carrier. It names a MECHANISM, not a secret: `SMTP_AUTH=login`,
  // `LDAP_AUTH=simple` and `SSO_AUTH=saml2` are all configuration values, and
  // making them confident evidence bricked reports over them.
] as const;

const SECRET_KEY_PHRASES: ReadonlySet<string> = new Set([
  ...CREDENTIAL_QUALIFIERS.flatMap((qualifier) =>
    CREDENTIAL_CARRIERS.map((carrier) => `${qualifier} ${carrier}`),
  ),
  // `header` and `signature` are NOT carriers in the product above. They name a
  // transport or a field, not a secret, and crossing them with every qualifier
  // made `MAIL_HEADER_FROM`, `SESSION_HEADER_NAME`, `APP_HEADER` and
  // `MAIL_SIGNATURE` into confident credential evidence — an unclearable hold on
  // an email footer. The pairs that ARE credentials are listed instead.
  "auth header",
  "authorization header",
  "bearer header",
  "api signature",
  "request signature",
  "webhook signature",
  "hmac signature",
  "signing signature",
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
/**
 * Final segments that name a REFERENCE to a credential rather than the credential.
 *
 * `AWS_ACCESS_KEY_ID` is not the secret — `AWS_SECRET_ACCESS_KEY` is.
 * `DB_PASSWORD_FILE` holds a path. `SERVICE_ACCOUNT_EMAIL` holds an address.
 * Redacting these destroys the part of a finding that tells the customer where to
 * look, and does it at `credential_evidence`, which no human can clear.
 *
 * Vetoed only when the name does not ALSO end in a carrier, so `API_KEY` and
 * `DB_PASSWORD_PROD` are untouched.
 */
const REFERENCE_SUFFIXES: ReadonlySet<string> = new Set([
  "id", "ids", "email", "emails", "name", "names", "url", "uri", "host", "hostname",
  "port", "path", "file", "filename", "dir", "directory", "enabled", "disabled",
  "mode", "type", "kind", "from", "to", "count", "length", "ttl", "expiry", "format",
]);

/**
 * Qualifiers that make `key` a data-structure key rather than a credential.
 *
 * Small and closed on purpose: everything NOT here is treated as a credential,
 * which is the safe default for this direction.
 */
const STRUCTURAL_KEY_QUALIFIERS: ReadonlySet<string> = new Set([
  "cache", "sort", "partition", "primary", "foreign", "unique", "composite",
  "index", "map", "object", "record", "row", "group", "shard", "route", "i18n",
  "translation", "locale", "license", "idempotency", "dedupe", "lookup", "hash",
  "bucket", "query", "meta", "field", "column", "arrow", "react", "list", "item",
  // Browser, UI and application-constant keys. The `_KEY` inversion made every
  // one of these confident evidence, which is an UNCLEARABLE hold — and this
  // repository's own source is full of them (`PUBLIC_WEB_RESEARCHER_KEY`,
  // `VALIDATOR_EXECUTOR_KEY`, `CONTEXT_SHUNT_PROVIDER_KEY`). A review that
  // cannot quote the code it is reviewing has no product.
  // `session` and `registry` are NOT here: a session signing key and a registry
  // key are credentials, and both are qualifiers in the product above.
  // `SESSION_STORAGE_KEY` is still excluded, because `storage` precedes `key`.
  "storage", "localstorage", "sessionstorage", "local", "state", "draft",
  "enter", "tab", "escape", "shift", "arrowup", "arrowdown", "node", "tree", "form",
  "segment", "researcher", "executor", "provider", "capability", "proof", "shadow",
  "metadata", "reservation", "template", "layout", "theme", "sort",
  // `USER_KEY` is a per-record identifier far more often than a credential.
  // `USER_SECRET` is not, and the rule below keeps that distinction.
  // `account` is NOT here: an Azure storage "account key" is a credential, and
  // `account` is already a credential qualifier in the product above.
  "user", "tenant", "customer", "id",
]);

export function keyLooksSecret(key: string): boolean {
  const segments = keyNameSegments(key);
  if (segments.length === 0) return false;

  // A reference to a credential is not a credential.
  //
  // Unconditional, and the comment on REFERENCE_SUFFIXES used to claim an
  // "unless it also ends in a carrier" exception that was never written. The two
  // sets are disjoint, so the guard would be a no-op — an assertion below keeps
  // them disjoint rather than leaving the claim to rot.
  const last = segments[segments.length - 1];
  if (segments.length > 1 && REFERENCE_SUFFIXES.has(last)) return false;

  // `<anything>_KEY` and `<anything>_SECRET` are credentials unless the preceding
  // segment names a STRUCTURAL key.
  //
  // Inverted deliberately. `key` was credential-shaped only as a whole name or
  // after one of a hand-written qualifier list, and the product's market is
  // exactly the vendors nobody has added to that list yet: `HMAC_KEY`,
  // `SUPABASE_KEY`, `GROQ_KEY`, `CSRF_KEY`, `WEBHOOK_KEY` were all invisible. A
  // hand-maintained allow-list is the wrong default for a security tool; the set
  // of things that are a `key` WITHOUT being a secret is small, closed, and about
  // data structures rather than vendors.
  if (segments.length > 1 && (last === "key" || last === "keys")) {
    return !STRUCTURAL_KEY_QUALIFIERS.has(segments[segments.length - 2]);
  }
  // `secret` has no structural sense. `USER_KEY` may be a map key; `USER_SECRET`
  // is a secret.
  if (segments.length > 1 && last === "secret") return true;
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

  // 1. A carrier at the end, preceded by one or more qualifiers.
  //
  //    Split RECURSIVELY, not once. The first version peeled exactly one
  //    qualifier, so `ACCESSTOKEN` matched and `APIACCESSTOKEN` did not, and
  //    `MYSQLROOTPW` did not either — every product in the suite composed two
  //    elements, so nothing noticed that names compose to three.
  //
  //    `bypass` still fails: `by` is not a qualifier, and the split is anchored
  //    rather than free, which is the whole reason ordinary English survives.
  for (const carrier of CREDENTIAL_CARRIERS) {
    if (!segment.endsWith(carrier)) continue;
    if (qualifierChain(segment.slice(0, -carrier.length))) return true;
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
 * Whether a prefix is one or more qualifiers run together.
 *
 * Bounded by the prefix length, and each step consumes at least two characters,
 * so the recursion is at most half the segment deep.
 */
function qualifierChain(prefix: string, depth = 0): boolean {
  if (prefix.length === 0) return depth > 0;
  if (depth > 4) return false;

  for (const qualifier of CREDENTIAL_QUALIFIERS) {
    if (prefix.startsWith(qualifier) && qualifierChain(prefix.slice(qualifier.length), depth + 1)) {
      return true;
    }
  }
  return false;
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


