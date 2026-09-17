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
  { mechanism: "word_insertion", value: "Acme Is Secure's Ltd" },

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
 * `NEGATION_TOKENS` and simply missing. Fixing those is what makes the rest of
 * this list a bound rather than a backlog: what remains needs a new SHAPE, not
 * another spelling of one already recognised.
 *
 * "This is anything but a penetration test" is here because of the coordinator
 * clause break, which is the cost of closing the blocking defect above: `but`
 * ends the clause, so the denial it belongs to is not in the claim's clause.
 */
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
];

export const CLAIM_GUARD_BOUND_SENTENCE =
  "A claim word inside an all-caps run is not caught, nor is one split by an inserted word; the recorded residuals are in `release-rescue-claim-guard-residuals.ts`.";

/** Residuals that stand alone as a field value, rather than needing a carrier sentence. */
export const STANDALONE_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => !residual.needsCarrier);

/** Residuals that are fragments, to be read inside a carrier sentence. */
export const FRAGMENT_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => residual.needsCarrier);
