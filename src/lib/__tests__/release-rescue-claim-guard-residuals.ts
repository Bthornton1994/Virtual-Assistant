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
  | "no_boundary"
  /**
   * OFFER COPY ONLY. A negation anywhere earlier in the same clause licenses the
   * claim, even when the negation is not about it: "We never rest until your
   * application is secure" is an affirmative claim with an unrelated denial in
   * front of it, and the whole clause is switched off.
   *
   * Every other residual here is a typed-field evasion — something an operator
   * could type. This one is the reverse: it is a bound on the SURFACE the guard
   * is said to govern, and it was unrecorded until an audit served three such
   * sentences from the offer's own landing page at HTTP 200.
   *
   * A distance rule does not fix it, MEASURED rather than assumed. Requiring the
   * negation within N tokens of the claim was implemented and swept over the
   * whole 174-file surface:
   *
   *   reach 2-3  catches all three payloads, breaks no real copy — but also
   *              rejects two DECLARED denials this suite requires to pass,
   *              "We never claim your application is secure" and "We cannot
   *              guarantee your application is secure", whose negations sit four
   *              tokens out;
   *   reach 4+   permits those two, and permits "Without exception your
   *              application is secure", whose unrelated negation sits three.
   *
   * The legitimate denial and the affirmative claim are the same shape at the
   * same distance, so no token-distance rule separates them; the difference is
   * what the negation GOVERNS, which this tokenizer does not model. Tightening
   * further means either rejecting denial phrasings the offer currently uses, or
   * licensing only sentences declared verbatim — both of which change what
   * marketing copy is permitted without a code change. That is an owner
   * decision, so it is recorded here rather than made quietly.
   *
   * What stands in the meantime: offer copy is written by this repository and
   * reviewed by a person, the four disclaimers are declared and literal-true,
   * and a TYPED FIELD — anything a customer supplies — is read as
   * `typed_field`, where no disclaimer licenses anything.
   */
  | "unrelated_negation_licenses_offer_copy";

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
 * The offer-copy licensing residual, kept separate because it is not a typed
 * value: each is a whole sentence a surface could publish, read as offer copy.
 */
export const OFFER_COPY_LICENSING_RESIDUALS: readonly string[] = [
  "We never rest until your application is secure.",
  "We do not stop working until your application is secure and free of vulnerabilities.",
  "Without exception your application is secure after this review.",
];

export const CLAIM_GUARD_BOUND_SENTENCE =
  "A claim word inside an all-caps run is not caught, nor is one split by an inserted word; the recorded residuals are in `release-rescue-claim-guard-residuals.ts`.";

/** Residuals that stand alone as a field value, rather than needing a carrier sentence. */
export const STANDALONE_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => !residual.needsCarrier);

/** Residuals that are fragments, to be read inside a carrier sentence. */
export const FRAGMENT_RESIDUALS = CLAIM_GUARD_RESIDUALS.filter((residual) => residual.needsCarrier);
