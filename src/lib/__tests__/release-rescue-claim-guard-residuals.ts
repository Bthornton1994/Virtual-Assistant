/**
 * What the claim guard does NOT catch, in one place.
 *
 * This file exists because the same fact was written down twice, 1,100 lines
 * apart, and the two copies disagreed. `ALL_CAPS_RUN` recorded `ACMEISSecure`
 * as a live evasion; a `NOT_CAUGHT` list in a different test named two other
 * payloads and justified them as the ONLY misses ("no word boundary of ANY
 * kind"); and `CONTROL_PLANE_PIN.because` — production source, emitted verbatim
 * in a refusal message — claimed the guard "now catches every separated and
 * camelCase form". `ACMEISSecure` is a camelCase form, is not caught, and was
 * recorded as not caught three functions away from the claim that it was.
 *
 * A residual is a property of the guard, so it is recorded beside the guard's
 * tests once and consumed everywhere. Two lists can disagree. One cannot.
 *
 * Nothing here is a payload the codebase produces. These are the strings an
 * operator could type that the guard would let through, kept so the bound is a
 * measurement rather than a silence — and so that a round which narrows the
 * bound has to come here and say so.
 */

/** How the payload gets past the guard. Each is a distinct mechanism. */
export type ResidualMechanism =
  /** A claim word inside an all-caps run: `ACMEISSecure` splits `ACMEIS|Secure`, and nothing tells the tokenizer that `IS` ends a word. */
  | "all_caps_run"
  /** A word inserted between the claim's two tokens, or a near-synonym the list does not carry. The matcher wants a contiguous token sequence. */
  | "word_insertion"
  /** A character substituted, doubled or inserted inside a claim word. Each is a different token to the matcher. */
  | "intra_word"
  /** No word boundary of any kind — no separator, no case transition. */
  | "no_boundary";

export type ClaimGuardResidual = {
  readonly mechanism: ResidualMechanism;
  /** The payload exactly as a caller would supply it. */
  readonly value: string;
  /**
   * True when `value` is a fragment rather than a whole field value, so a test
   * must place it in a carrier sentence before reading it. The intra-word
   * mutations are fragments; everything else is a value someone could type into
   * `reviewedBy.displayName` as it stands.
   */
  readonly needsCarrier?: true;
};

export const CLAIM_GUARD_RESIDUALS: readonly ClaimGuardResidual[] = [
  // Audit 25 found a commit message asserting these three were "in the
  // recorded-residual test" when they were absent from the repository
  // entirely — worse than an unrecorded hole, because the next round reads the
  // message, believes the record exists, and does not look.
  { mechanism: "all_caps_run", value: "ACMEISSecure Ltd" },
  { mechanism: "all_caps_run", value: "ThisAppISSECURE Ltd" },
  { mechanism: "all_caps_run", value: "Acme'Is'Secure Ltd" },
  // The same mechanism without the legal suffix. These are the forms that fit
  // the control-plane format, so they are the ones that reach a `generated`
  // path — which is what audit 27 walked through while the format's own
  // `because` said they could not.
  { mechanism: "all_caps_run", value: "ACMEISSecure" },
  { mechanism: "all_caps_run", value: "ThisAppISSECURE" },
  { mechanism: "all_caps_run", value: "AcmeISsecure" },

  // Audit 26. Plain ASCII, no casing trick, no unicode: a word between the
  // claim's two tokens. `Ops Manager, Your App Is Now Secure` on the signature
  // line of a $299 prepare-only report reads to a customer as exactly the
  // guarantee the offer forbids.
  //
  // Recorded rather than fixed: catching it needs either a gap-tolerant match
  // (which would flag ordinary prose) or a synonym list (an open set, and an
  // open set is what six rounds of this file are about).
  { mechanism: "word_insertion", value: "Ops Manager, Your App Is Now Secure" },
  { mechanism: "word_insertion", value: "Dana Okafor, Acme - Your App Is Totally Secure" },
  { mechanism: "word_insertion", value: "Acme 100% Secure Ltd" },
  { mechanism: "word_insertion", value: "Acme Is 2 Secure Ltd" },
  { mechanism: "word_insertion", value: "Zero Vulnerabilities Ltd" },
  { mechanism: "word_insertion", value: "Acme Free From Vulnerabilities Ltd" },
  // Measured when the typed-field list gained the professional claims
  // ("penetration tester", "compliance certified", ...). A credential that
  // reorders the list's words, puts one between them, or is spelled as an
  // acronym or a synonym the list does not carry still goes through.
  { mechanism: "word_insertion", value: "Certified in compliance" },
  { mechanism: "word_insertion", value: "Certified compliance professional" },
  { mechanism: "word_insertion", value: "Certified Security Professional" },
  { mechanism: "word_insertion", value: "Certified by SOC 2" },
  { mechanism: "word_insertion", value: "Compliance certifier" },
  { mechanism: "word_insertion", value: "Dana Okafor, OSCP" },
  // Measured with the typed-field rules for possessives, clause breaks and the
  // narrow compliance and credential phrases in place. Credential acronyms and
  // near-synonyms are not matched, because matching them broadly would refuse
  // ordinary names and titles; each is recorded rather than guessed at.
  { mechanism: "word_insertion", value: "CISSP" },
  { mechanism: "word_insertion", value: "CEH" },
  { mechanism: "word_insertion", value: "OSCP certified" },
  { mechanism: "word_insertion", value: "CREST certified" },
  { mechanism: "word_insertion", value: "PCI QSA" },
  { mechanism: "word_insertion", value: "CISA" },
  { mechanism: "word_insertion", value: "Certified Information Systems Auditor" },
  { mechanism: "word_insertion", value: "offensive security professional" },
  { mechanism: "word_insertion", value: "appsec auditor" },
  { mechanism: "word_insertion", value: "security researcher" },
  { mechanism: "word_insertion", value: "bug bounty hunter" },

  // Audit 23 widened this class with invisible characters and non-ASCII
  // letterforms. Exact stem matching cannot close it — each is a different
  // token to the matcher, and normalising them away would collapse legitimate
  // words.
  //
  // `is\u200bsecure` is NOT here, and that is the point of recording residuals
  // as an exact set. It sat in this corpus for four rounds under the title "the
  // evasions the claim guard cannot see" while being caught under both sources:
  // a zero-width space is a separator, so the tokenizer reads `is|secure` and
  // the claim matches. The assertion over the corpus was
  // `expect(uncaught.length).toBeGreaterThan(0)`, which passes while seven of
  // eight entries are wrong. A floor cannot tell a record from a fiction.
  { mechanism: "intra_word", value: "sec\u00adure", needsCarrier: true },
  { mechanism: "intra_word", value: "sec'ure", needsCarrier: true },
  { mechanism: "intra_word", value: "sec-ure", needsCarrier: true },
  { mechanism: "intra_word", value: "secuure", needsCarrier: true },
  { mechanism: "intra_word", value: "is secu re", needsCarrier: true },
  { mechanism: "intra_word", value: "ｉｓ ｓｅｃｕｒｅ", needsCarrier: true },
  { mechanism: "intra_word", value: "ıs secure", needsCarrier: true },
  // A lookalike letter inside a typed-field professional claim: Cyrillic `е`
  // and fullwidth letters are different tokens to the matcher.
  { mechanism: "intra_word", value: "P\u0435n tester" },
  { mechanism: "intra_word", value: "\uff50\uff45\uff4e\uff54\uff45\uff53\uff54\uff45\uff52" },

  // The floor case: strip every boundary and there is nothing for a tokenizer
  // to find without searching for claim text inside longer words, which would
  // flag ordinary values.
  { mechanism: "no_boundary", value: "thisappissecureandfreeofvulnerabilities" },
  { mechanism: "no_boundary", value: "THISAPPISSECURE" },
];

/**
 * The one-line statement of the bound, owned here and required verbatim in
 * `CONTROL_PLANE_PIN.because`.
 *
 * The production string used to assert a CATEGORY — "catches every separated
 * and camelCase form" — which is the shape of claim that cannot be checked and
 * was false for two rounds. It now carries this sentence instead, and a test
 * asserts it does. Narrowing the bound means editing this constant, which turns
 * the production text red until it is corrected too.
 */
/**
 * Sentences that an unrelated denial used to license, now CAUGHT.
 *
 * Three rules have been tried here and two were recorded in this file as
 * settled. Both records were wrong, which is why the corpus is kept rather than
 * the reasoning.
 *
 * The first record said no rule in code could close the hole and only an owner
 * could decide the trade-off, resting on a distance: "Without exception your
 * application is secure" supposedly put its negation THREE tokens before the
 * claim while two required denials put theirs at FOUR. Measured, all three sit
 * at four. An auditor then wrote the rule the record said did not exist.
 *
 * That rule — license the claim unless a negation-shaped intensifier or a
 * subordinating conjunction intervenes — was NEGATIVE: it licensed whatever its
 * two lists failed to describe, so it failed OPEN. The next audit served "In no
 * uncertain terms your application is secure" through it at HTTP 200, and had
 * five ordinary denials rejected by the same lists.
 *
 * The rule in force is positive (`denialShapeGoverns`): a denial is recognised
 * only in one of FOUR shapes this offer writes — a negation adjacent to the
 * claim, a negation on one of the offer's own reporting verbs, a SUBJECT
 * negation whose predicate denies one, or a contrast head pointing away from it.
 * Everything else is an affirmative claim.
 *
 * The subject-negation arm was missing from this paragraph for one round, which
 * is the same defect this file's opening comment is about: the record that
 * exists so one fact is written down once, describing the rule in force with one
 * of its arms left out.
 *
 * Two of those arms were also UNBOUNDED. A negation on a reporting verb licensed
 * every claim anywhere later in the clause, and the clause ended only at
 * punctuation — so "We do not claim to be the cheapest, but your application is
 * secure" was caught and the same sentence without the comma was licensed and
 * served at HTTP 200. The clause now ends at a `COORDINATORS` word as well as at
 * punctuation, and the adjacency arms skip one determiner rather than any run of
 * function words.
 *
 * Measured over the corpus of 174 surface files and 6 scannable assets: all
 * seventeen below caught, all twenty-one declared denials licensed, and the
 * flagged set outside the one declared exemption unchanged at zero.
 *
 * They stay here as a REGRESSION corpus rather than a residual: each must now be
 * caught as offer copy, which is the opposite of what this file records for
 * everything else, so the name says so.
 */
export const NEGATION_SCOPE_REGRESSIONS: readonly string[] = [
  // Audit 39: a negation anywhere in the clause licensed the claim.
  "We never rest until your application is secure.",
  "We do not stop working until your application is secure and free of vulnerabilities.",
  "Without exception your application is secure after this review.",
  // Audit 41: negation-shaped intensifiers the scope list did not name, and
  // subordinating conjunctions beyond the three it carried.
  "In no uncertain terms your application is secure.",
  "Without a doubt your application is secure.",
  "Without any exception your application is secure.",
  "We never rest as soon as your application is secure.",
  "We do not stop working provided that your application is secure.",
  // The two arms the mutation proof found nothing holding: a subject negation
  // whose skip is not bounded by an auxiliary would reach `say` here, and a
  // contrast head that does not have to point straight at the claim would
  // license anything after "rather than".
  "No fewer than three reviewers say your application is secure.",
  "We confirm rather than guess that your application is secure.",
  // Audit 44. The payload the previous round's commit message and PR body both
  // cited as the evidence for the subject-negation exclusion — and which existed
  // in neither this corpus nor any test. A record that nothing executes is not
  // evidence, which is this repository's own fourth rule.
  "No guarantee is needed because your application is secure.",
  // Audit 42. A denial earlier in the same clause licensed every claim after it,
  // at any distance, because arms (b) and (c) had no bound and the clause ended
  // only at punctuation. Each of these was served or measured as LICENSED.
  "We do not claim to be the cheapest but your application is secure.",
  "We cannot promise a date but we are SOC 2 certified.",
  "We do not guarantee delivery dates however your application is secure.",
  "We never promise speed although your application is secure.",
  "No reviewer can guarantee anything so we went further and your application is fully secure.",
  // And the two where the adjacency skip crossed a phrase rather than a
  // determiner, because every word in between happened to be a function word.
  "Other than that it is secure.",
  "No other such is secure.",
];

/**
 * Denial phrasings the recogniser does NOT read, measured rather than asserted.
 *
 * A positive rule fails closed, so every shape it does not carry costs an author
 * a rewording. That is the accepted trade, but "17 declared denials licensed"
 * measures only the denials someone thought to declare. These are ordinary
 * English denials of the things this offer refuses, each FLAGGED today.
 *
 * Four more were here until an audit found them: `by no means`, and the `ain't`,
 * `shan't` and `mustn't` contractions, which were in-family with every entry in
 * `NEGATION_TOKENS` and simply missing.
 *
 * A round then claimed that what remained "needs a new SHAPE, not another
 * spelling of one already recognised". That was false when it was written, and
 * the next audit wrote eight sentences to show it: the same shapes, defeated by
 * one adjective or one adverb. They are in the list now. The bound is what is
 * measured here, not a story about how principled the remainder is.
 *
 * "This is anything but a penetration test" is here because of the coordinator
 * clause break, which is the cost of closing the blocking defect above: `but`
 * ends the clause, so the denial it belongs to is not in the claim's clause.
 */
/**
 * Claims a REFERRAL used to license by sharing a clause with it.
 *
 * A referral refers specific items away — "customers who need penetration
 * testing should engage a qualified specialist". The arm licensed any claim in
 * the same clause as any referral, in either direction, so an affirmative claim
 * standing next to a referral about something else was licensed. Each of these
 * must now be CAUGHT.
 */
export const REFERRAL_SCOPE_REGRESSIONS: readonly string[] = [
  "Your application is secure although penetration testing is out of scope.",
  "Your application is secure so penetration testing is out of scope.",
  "We are SOC 2 certified but penetration testing is out of scope.",
  "We do not claim to be the cheapest but your application is secure although penetration testing is out of scope.",
];

/**
 * Connectives for the licensing sweep, taken from an English grammar.
 *
 * Deliberately NOT derived from anything in this repository. The previous round
 * published "29 affirmative payloads spanning every coordinator" — a corpus
 * built from the `COORDINATORS` list it was validating, which is why it showed
 * 29 of 29 caught while eight ordinary connectives walked through. Evidence
 * composed inside its own premise, three paragraphs after the file that says a
 * record must be able to disagree with the thing it records.
 *
 * `LICENSING_SWEEP_TEMPLATES` x these is the corpus, computed rather than typed,
 * so the count in the architecture doc is a product of two arrays a test reads.
 *
 * THE CONNECTIVES WERE NEVER THE AXIS THAT MATTERED. Freeing them from this
 * module's own list fixed the defect the round before had, and left the real one
 * in place: all four templates filled the denial verb's complement slot, so the
 * complement bound rejected every one of them whatever word was substituted, and
 * 208 of 208 was the only answer the corpus could produce. It was structurally
 * incapable of detecting either licensing defect an audit then found. The
 * templates now vary WHAT OCCUPIES THE SLOT, which is the axis that decides the
 * outcome.
 */
export const SWEEP_CONNECTIVES: readonly string[] = [
  "but", "yet", "and", "or", "nor", "for", "so", "however", "nevertheless", "nonetheless",
  "though", "although", "whereas", "otherwise", "therefore", "thus", "hence", "meanwhile",
  "moreover", "furthermore", "besides", "regardless", "anyway", "while", "when", "whenever",
  "because", "since", "as", "after", "before", "until", "unless", "once", "still", "plus",
  "then", "also", "additionally", "conversely", "instead", "rather", "albeit", "notwithstanding",
  "accordingly", "consequently", "indeed", "alternatively", "only", "except", "meantime", "ergo",
];

/**
 * Sentence shapes that put a real denial in front of an affirmative claim.
 *
 * One per licensing arm the bound applies to: a reporting verb with an
 * infinitive complement, one with a noun-phrase complement, one with neither,
 * and a subject negation reaching its verb through an auxiliary.
 */
export const LICENSING_SWEEP_TEMPLATES: ReadonlyArray<(connective: string) => string> = [
  // 1-3: the complement slot filled by an infinitive, a noun phrase, and a bare
  // noun. These four were the WHOLE corpus, and that is why it could not fail:
  // a filled slot is rejected by the complement bound whatever follows it, so
  // 208 of 208 was the only answer the corpus could ever give.
  (c) => `We do not claim to be the cheapest ${c} your application is secure.`,
  (c) => `We cannot promise a date ${c} we are SOC 2 certified.`,
  (c) => `We never guarantee delivery ${c} we deliver a penetration test.`,
  (c) => `No reviewer can say much about price ${c} your application is fully secure.`,
  // 4-5: a `that` COMPLEMENT about something else. The slot is filled by a
  // clause rather than a phrase, and the arm licensed everything after the
  // `that` at any distance. 52 of 52 connectives went through.
  (c) => `We do not claim that our pricing is the best ${c} your application is secure.`,
  (c) => `We never guarantee that scope is wide ${c} your application is fully secure.`,
  // 6-7: a SUBJECT negation whose auxiliary sits far from it, reaching a
  // genuinely affirmative guarantee later in the sentence. Caught at both
  // predecessors, licensed once the clause stopped being cut at a connective.
  (c) => `No refunds are given after delivery ${c} we do guarantee your application is secure.`,
  (c) => `No part of this is rushed ${c} we do offer a penetration test.`,
  // 8: a determiner `that` immediately after the verb, which is not a
  // complementizer at all — "say THAT MUCH" — and must not open the arm.
  (c) => `We cannot say that much ${c} we are ISO 27001 certified.`,
];

/**
 * Denials the guard rejects because a CHARACTER REFERENCE stands inside them.
 *
 * The extractor reads every string twice: decoded, and as written. The second
 * reading exists because decoding can ERASE text — `S&P500 clients` became
 * `S clients` — and a round that tried to gate it on "the run ends in a
 * semicolon, so it is a real reference" was measured wrong: `&test;` ends in a
 * semicolon, is not a reference, a browser prints it literally, and gating on
 * that lost the claim in `We deliver a penetration&test; it is thorough`.
 *
 * So both readings are kept, and the cost lands here. In the undecoded reading
 * the reference survives as its own tokens AND its semicolon ends the clause, so
 * `This isn&rsquo;t a penetration test` reads as `isn rsquo` / `t a penetration
 * test` and the negation is no longer in the claim's clause.
 *
 * This is NOT closable by another rule in this file. `&rsquo;` and `&test;` are
 * the same shape; a browser tells them apart with the HTML5 named-character
 * table of roughly 2,200 entries, which this repository does not have and which
 * is a dependency decision rather than a guard fix — the module's own history is
 * why an eleven-name hand-written substitute is not acceptable here. Recorded
 * and executed instead, fail-closed: each costs an author one rewording into the
 * plain apostrophe, and no copy in this repository is affected today.
 */
export const REFERENCE_INSIDE_A_DENIAL: readonly string[] = [
  "const P = () => <p>This isn&rsquo;t a penetration test.</p>;",
  "const P = () => <p>This isn&apos;t a penetration test.</p>;",
  "const P = () => <p>This isn&#39;t a penetration test.</p>;",
];

export const UNRECOGNISED_DENIAL_PHRASINGS: readonly string[] = [
  "We stop short of a penetration test.",
  "We fall short of a penetration test.",
  "This review falls well short of a penetration test.",
  "This is anything but a penetration test.",
  "Far from a penetration test, this is a source review.",
  "At no point do we claim your application is secure.",
  "Under no circumstances do we guarantee your application is secure.",
  "Nowhere do we claim your application is secure.",
  "We refrain from claiming your application is secure.",
  // Audit 43. These are NOT new shapes — they are shapes the recogniser already
  // carries, defeated by ONE intervening word: an adjective after the
  // determiner, or an adverb before the verb. The doc claimed the remaining
  // residual "needs a new SHAPE, not another spelling of one already
  // recognised", and that was false when it was written.
  //
  // Widening the adjacency skip to one determiner PLUS one content word was
  // measured and rejected: it re-licenses "Other than that it is secure", an
  // audit payload in the regression corpus above. The cost is recorded here
  // instead of traded for that.
  "This is not a full penetration test.",
  "This review is not a formal penetration test.",
  "This review is not any kind of penetration test.",
  "We do not ever claim your application is secure.",
  "We do not currently claim your application is secure.",
  "We never actually claim your application is secure.",
  "It is not the case that your application is secure.",
  // And one more cost of the complement bound: an adverb between the negation
  // and its verb puts the verb out of reach.
  "We do not however guarantee that your application is secure.",
];

export const CLAIM_GUARD_BOUND_SENTENCE =
  "A claim word inside an all-caps run is not caught, nor is one split by an inserted word; the recorded residuals are in `release-rescue-claim-guard-residuals.ts`.";

/** Residuals that stand alone as a field value, rather than needing a carrier sentence. */
export const STANDALONE_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => !residual.needsCarrier);

/** Residuals that are fragments, to be read inside a carrier sentence. */
export const FRAGMENT_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => residual.needsCarrier);
