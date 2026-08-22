# Autonomous Portfolio Execution Playbook

Status: **Owner-approved execution direction, 2026-08-21.**

Purpose: turn the owner's existing GitHub businesses into increasingly self-operating companies while using Delegation Cloud as the governing execution layer and proving whether Delegation Cloud's strategic thesis works in reality.

This document is intentionally conservative about autonomy. It is not a promise that Grok Bot, Delegation Cloud, or any current agent can independently make a business successful. Success still depends on product-market fit, customer demand, economics, legal and operational constraints, and human judgment. The goal is narrower and measurable: **reduce the amount of owner coordination required to operate and improve the businesses without reducing quality, safety, or accountability.**

Read in this order:

1. `VISION.md` — governing product boundaries.
2. `docs/DELEGATION-CLOUD-STRATEGIC-THESIS.md` — strategic thesis to prove.
3. This document — execution sequence.

---

# Part I — The operating architecture

## 1. Do not build six unrestricted AI CEOs

The portfolio should not begin with one general agent per company that has broad credentials and a prompt such as “grow this business.” That architecture is difficult to verify, difficult to secure, and prone to producing activity rather than useful business progress.

Use four layers instead:

```text
OWNER / BOARD
    |
    v
PORTFOLIO CONTROL LAYER
Delegation Cloud + Portfolio Manager
    |
    +----------------+----------------+----------------+
    v                v                v                v
Company workstreams  Company workstreams  Company workstreams ...
    |
    +--------+--------+---------+---------+
    |        |        |         |         |
    v        v        v         v         v
Software   AI agent  Grok Bot  Human    Specialist
/APIs      calls      worker    operator
```

The owner sets mission, risk tolerance, capital limits, major strategic decisions, and approval boundaries.

Delegation Cloud tracks outcomes, authority, execution, evidence, exceptions, workstream maturity, and cross-portfolio reporting.

Grok Bot is initially a persistent worker and coordinator, not the source of truth, not the security boundary, and not an unrestricted corporate officer.

Deterministic workflows and APIs execute repeatable logic.

Humans and specialists remain responsible for judgment-heavy or consequential work.

---

## 2. What Grok Bot should own

Use Grok Bot where persistent context, initiative, browser/terminal operation, scheduled routines, and agent-to-agent coordination materially help.

Good initial uses:

- inspect a repository and its current issues/PRs;
- run a daily or weekly business review;
- research competitors or vendors;
- monitor a defined set of sources;
- create draft GitHub issues from observed problems;
- prepare product or growth experiments;
- inspect application behavior;
- summarize operational changes;
- prepare owner decision packets;
- run previously proven routines;
- coordinate low-risk work among clearly scoped Bots.

Do not initially use Grok Bot as the sole mechanism for:

- financial transfers;
- contracts;
- production-secret custody across unrelated tenants;
- destructive production database changes;
- unsupervised customer communications;
- bulk publishing;
- legal, medical, regulated, or fiduciary decisions;
- silent permission changes;
- arbitrary production deployment with no independent verification.

Grok Bot is a useful persistent worker. It should not become the architecture.

---

## 3. What belongs in deterministic infrastructure instead

Use ordinary software whenever the workflow is known and objectively executable.

Examples:

- GitHub Actions for CI, tests, release gates, scheduled repository checks, and deterministic event handling.
- Vercel for hosting, deployment, application observability, and durable application workflows when appropriate.
- Supabase for data, auth, row-level security, events, queues/cron, and tenant-scoped state.
- Stripe or another payment processor for billing logic.
- Direct vendor APIs for catalog or fulfillment updates.
- OAuth-scoped integrations for Gmail, Calendar, CRM, and similar systems.

Rule:

> **Agent reasoning decides what should happen when judgment is useful. Deterministic software performs known steps when deterministic software is more reliable.**

Avoid browser automation when a stable API exists.

---

## 4. Source-of-truth hierarchy

Agents must not invent strategy from chat history.

For each company, use this precedence:

1. `VISION.md` or equivalent governing doctrine.
2. explicit owner decisions and authority policy;
3. current business strategy and KPI definitions;
4. verified application and operational state;
5. current analytics and customer evidence;
6. current experiment backlog;
7. agent reasoning.

Agent conclusions are recommendations unless the action falls inside an already approved authority envelope.

---

# Part II — Portfolio governance package

## 5. Standardize every repository before adding autonomy

Each active business repository should eventually contain a `/company` or `/ops` governance package containing equivalent information even if filenames differ.

Minimum standard:

```text
VISION.md
AGENTS.md
company/
  STRATEGY.md
  CURRENT_STATE.md
  KPI_TREE.yaml
  AUTHORITY_MATRIX.yaml
  DECISION_LOG.md
  EXPERIMENT_LOG.md
  RISK_REGISTER.md
  WORKSTREAMS.md
  OWNER_ESCALATIONS.md
```

Do not copy identical business strategy across repositories. Standardize structure, not substance.

### `STRATEGY.md`

Contains:

- customer;
- problem;
- product;
- current business model;
- current strategic priority;
- explicit non-priorities;
- current assumptions to prove.

### `CURRENT_STATE.md`

Machine-readable enough for an agent to determine:

- deployed environments;
- known blockers;
- current release stage;
- live integrations;
- missing integrations;
- business launch status;
- known production risks.

### `KPI_TREE.yaml`

Defines the measurable business state.

Example categories:

```yaml
north_star:
leading_indicators:
quality:
reliability:
financial:
customer:
```

Only include metrics that can be sourced or deliberately collected. Do not manufacture precision.

### `AUTHORITY_MATRIX.yaml`

Defines actions by risk and autonomy level.

Minimum classes:

```yaml
observe:
prepare:
reversible_internal_execute:
external_execute:
sensitive_execute:
owner_only:
```

### `DECISION_LOG.md`

Records consequential owner decisions and why they were made.

### `EXPERIMENT_LOG.md`

Every experiment records:

- hypothesis;
- baseline;
- action;
- primary metric;
- guardrail metrics;
- result;
- interpretation;
- decision;
- follow-up.

### `RISK_REGISTER.md`

Tracks technical, legal, commercial, supplier, security, reputational, and operational risks with owners and mitigation.

---

# Part III — The autonomy ladder

## 6. Every company progresses through the same ladder

Do not skip levels merely because the agent appears capable.

### Level A — Instrumented manual operation

Humans still perform the workflow, but the steps, data, exceptions, and decisions are recorded.

Exit evidence:

- workflow can be described;
- input sources are known;
- definition of done exists;
- common exceptions are documented;
- baseline cost/time/owner-touch is known.

### Level B — Observe

Agent reads the systems and recommends what should happen. It does not change anything.

Exit evidence:

- recommendations are useful;
- false positives are understood;
- missing context is identifiable;
- no sensitive access is unnecessarily granted.

### Level C — Prepare

Agent produces drafts, plans, proposed database changes, PRs, reports, or queued actions.

Exit evidence:

- prepared outputs pass human review consistently;
- verification method exists;
- corrections are declining.

### Level D — Controlled execution

Agent or deterministic workflow performs a narrow reversible action after explicit approval or inside a tightly defined pre-authorization.

Exit evidence:

- execution can be independently verified;
- rollback exists;
- QA remains high;
- zero authority breaches.

### Level E — Bounded autonomous execution

Routine proven actions run without per-run owner approval inside explicit thresholds.

Exit evidence:

- repeated clean history;
- exceptions reliably escalate;
- owner coordination falls materially;
- cost and error rates remain acceptable.

### Level F — Exception-only supervision

A mature recurring workstream executes within a known policy and only requests human attention for exceptions or consequential decisions.

This is the practical target for many routine operations. It is not the same as an unrestricted AI CEO.

---

# Part IV — The first Grok Bot roster

## 7. Start with four Bots, not dozens

The initial portfolio roster should be small enough to understand.

### Bot 1 — Portfolio Manager

Mission:

> Maintain an accurate view of the portfolio, identify the most important unresolved constraint in each active company, coordinate approved workstreams, and surface only decisions that genuinely require the owner.

Can:

- read all portfolio repositories;
- read approved business telemetry;
- read company operating documents;
- create internal analysis;
- create draft issues or recommendations;
- request work from other Bots;
- prepare owner briefings.

Cannot initially:

- merge production changes;
- spend money;
- communicate externally;
- change pricing;
- change business doctrine;
- change access permissions;
- delete production data.

### Bot 2 — Engineering Worker

Mission:

> Convert evidence-backed technical problems into small, testable, reviewable changes while preserving each repository's governing vision and release gates.

Can:

- inspect code;
- reproduce issues;
- create branches;
- implement changes;
- run tests;
- prepare PRs;
- diagnose failed CI;
- prepare preview deployments where the existing environment permits it.

Cannot initially:

- merge to production;
- change production credentials;
- bypass failed gates;
- delete production resources;
- weaken security controls to make tests pass.

### Bot 3 — QA / Verification Worker

Mission:

> Independently verify whether proposed technical and operational changes satisfy acceptance criteria and do not conflict with governing product doctrine.

It must not simply trust the Engineering Worker's self-report.

Can:

- inspect PR diffs;
- run tests;
- run browser checks;
- inspect preview deployments;
- compare against acceptance criteria;
- request revisions;
- prepare pass/fail evidence.

### Bot 4 — Growth / Market Worker

Mission:

> Identify evidence-backed acquisition, conversion, retention, distribution, and commercial opportunities without creating spam, unsupported claims, or activity for its own sake.

Can:

- research markets and competitors;
- prepare SEO/content opportunities;
- analyze public signals;
- prepare landing-page experiments;
- prepare outreach lists and drafts where lawful and appropriate;
- analyze available conversion data;
- create experiment proposals.

Cannot initially:

- mass-send outreach;
- publish unreviewed content;
- create unsupported marketing claims;
- spend on ads;
- change pricing.

Add specialist Bots only after a stable recurring role justifies one.

---

## 8. Grok Bot setup sequence

For each Bot:

1. Create the Bot with a single durable mission.
2. Connect only the minimum systems required for that mission.
3. Provide the relevant repository and governing documentation.
4. Define explicit forbidden actions.
5. Run the desired workflow manually with the Bot once.
6. Correct mistakes and ambiguities.
7. Save the successful procedure as a reusable skill/routine if Grok Bot supports that workflow cleanly.
8. Run again manually.
9. Only after repeat success, schedule it or connect it to an event trigger.
10. Review activity logs and exceptions until reliability is demonstrated.

Do not start by scheduling an untested prompt.

---

# Part V — Portfolio control loop

## 9. Build the daily control loop

The Portfolio Manager should eventually execute the following logic on a schedule:

### Observe

Collect only approved signals:

- open PRs;
- failed CI;
- production health;
- open customer/support issues where available;
- application analytics where available;
- revenue/commerce signals where available;
- experiment status;
- known business blockers;
- scheduled workstream status.

### Diagnose

For each company ask:

1. What changed?
2. Is something broken?
3. What is the current binding constraint?
4. What evidence supports that conclusion?
5. Is there already a workstream or experiment addressing it?

### Decide

Select the smallest evidence-backed next action.

Never create work merely because a Bot is idle.

### Delegate

Send work to the appropriate executor:

- deterministic workflow;
- Engineering Worker;
- QA Worker;
- Growth Worker;
- human;
- owner.

### Verify

Require evidence before completion.

### Learn

Update:

- experiment record;
- exception record;
- playbook;
- workstream maturity;
- current state.

### Escalate

Only escalate when:

- owner authority is required;
- policy is ambiguous;
- a meaningful exception cannot be safely resolved;
- cost/risk thresholds are exceeded;
- strategy needs to change.

---

# Part VI — Company-by-company first workstreams

## 10. Loadout — first autonomy proving ground

Why first:

- mostly digital operations;
- relatively observable outcomes;
- catalog and affiliate work can be bounded;
- lower regulatory burden than other portfolio businesses;
- product-data freshness creates recurring work suitable for automation.

First Delegation Spec:

### Workstream: Catalog Integrity

Objective:

> Keep published product information, external links, price/availability indicators, and federation/approval information as current and source-backed as practical.

Phase B — Observe:

- identify broken links;
- identify stale product records;
- identify products whose source information changed;
- identify approval claims requiring re-verification;
- create a review report.

Phase C — Prepare:

- prepare structured catalog changes;
- prepare supporting sources;
- create GitHub issue/PR where appropriate;
- prepare QA checklist.

Phase D — Controlled execute:

- allow non-destructive internal catalog updates with approval;
- verify final state after update.

Phase E — Autonomous:

Only mature, deterministic updates such as verified dead-link replacement or source-backed metadata refresh should become autonomous. Ambiguous technical claims remain human-reviewed.

Primary measurements:

- stale record count;
- broken link rate;
- time from source change to catalog update;
- human minutes per verified update;
- QA defect rate;
- affiliate conversion if available.

Second workstream after Catalog Integrity proves itself:

### Growth Experiment Loop

Observe acquisition and product-discovery behavior, propose one experiment at a time, implement with engineering/QA, measure result, keep or roll back.

Do not automate “publish more SEO content” as a perpetual routine without evidence that content is the constraint.

---

## 11. Grounded — supplier and catalog integrity

First Delegation Spec:

### Workstream: Supplier & Catalog Integrity

Objective:

> Keep the asset-light storefront honest about product availability, supplier information, safety/source information, fulfillment constraints, and customer-facing catalog state.

Observe:

- supplier availability;
- discontinued products;
- source changes;
- shipping/return changes;
- broken product links;
- missing or stale safety/source data.

Prepare:

- proposed catalog changes;
- replacement product research;
- supplier follow-up drafts;
- affected-kit analysis.

Controlled execution:

- internal catalog updates that are source-backed and reversible;
- no supplier commitment or external statement beyond approved authority.

Human gates remain for:

- safety interpretation;
- new vendor agreements;
- return-liability changes;
- material product claims;
- supplier contracts;
- changes to fulfillment responsibility.

Key measurements:

- catalog discrepancy rate;
- supplier-data freshness;
- affected orders avoided;
- customer-impact incidents;
- human intervention per update.

---

## 12. Manipulation Score — research and product integrity

First Delegation Spec:

### Workstream: Evidence Base Maintenance

Objective:

> Detect relevant new research or evidence, evaluate whether it materially affects the product framework, and prepare changes without overstating validity or violating the product's privacy and misuse boundaries.

Observe:

- new peer-reviewed research;
- relevant methodological criticism;
- product regressions;
- framework claims needing stronger sourcing.

Prepare:

- research brief;
- relevance assessment;
- recommended framework change;
- regression-test proposal;
- documentation updates.

Controlled execution:

- low-risk documentation and test updates after review.

Human gates remain for:

- published validity/accuracy claims;
- major scoring-framework changes;
- safety logic;
- changes affecting privacy or person-level inference boundaries.

Key measurements:

- research items screened;
- relevant findings found;
- time to evidence review;
- regression defects;
- unsupported claims detected;
- owner touch per review cycle.

---

## 13. Three White Lights — engineering quality, not game-feel autonomy

First Delegation Spec:

### Workstream: Release Quality

Objective:

> Detect, reproduce, prioritize, fix, and verify objective software defects while preserving human ownership of game feel.

Observe:

- crashes;
- build failures;
- telemetry anomalies where available;
- test failures;
- performance regressions;
- player-reported objective defects.

Prepare/execute:

- create issue;
- reproduce;
- implement fix;
- run tests;
- create PR;
- QA independently;
- prepare release candidate.

Human gate remains for:

- game feel;
- timing feel;
- art direction;
- difficulty experience;
- monetization decisions;
- release decisions until the release process itself is mature and bounded.

Key measurements:

- defect-to-PR time;
- regression rate;
- escaped defect rate;
- automated verification coverage;
- human engineering minutes;
- human playtest feedback for feel-sensitive changes.

---

## 14. CareReserve — market intelligence and follow-through only

CareReserve should progress more slowly because its external relationships and future public-program/benefits functions have materially higher policy and trust sensitivity.

First Delegation Spec:

### Workstream: Central Oregon Market Intelligence

Objective:

> Maintain a current, source-backed view of target employers, licensed provider landscape, reported capacity signals, relevant market developments, and open relationship follow-through without making unsupported eligibility, safety, quality, or funding assertions.

Observe:

- employer targets;
- provider public information;
- license-source status;
- provider-reported capacity where authorized;
- meetings and open follow-ups;
- relevant public market developments.

Prepare:

- employer briefs;
- provider briefs;
- meeting packs;
- CRM updates;
- outreach drafts;
- follow-up reminders.

Controlled internal execution:

- CRM hygiene and internal records within approved boundaries.

Human gates remain for:

- employer outreach until messaging is proven;
- provider relationship communications;
- representations about licensing, quality, safety, eligibility, taxes, benefits, or funding;
- contracts;
- public-program data;
- movement of funds;
- agency interaction.

Key measurements:

- target records kept current;
- meeting preparation time;
- follow-up latency;
- source freshness;
- unsupported-claim defects;
- human coordination burden.

---

## 15. Delegation Cloud — operate itself using Founder Follow-Through

Delegation Cloud must dogfood the product.

First internal workstreams:

### Executive Follow-Through

- maintain open decisions;
- maintain blocker list;
- monitor current PR/release state;
- prepare a weekly owner brief;
- surface only decisions requiring owner authority.

### Product/Engineering Follow-Through

- monitor release gates;
- convert verified defects into work;
- prepare code changes;
- independent QA;
- preserve current production restrictions.

### Commercial Follow-Through

Only after the product is ready for external design partners:

- prospect research;
- meeting preparation;
- CRM hygiene;
- follow-up drafts;
- design-partner feedback synthesis.

Delegation Cloud must record its own work using the same Delegation Spec, evidence, exception, economics, and Outcome Receipt concepts it intends to sell.

---

# Part VII — Deployment and engineering automation

## 16. Standardize repository engineering gates

Every active application repo should eventually have an equivalent deterministic gate:

```text
install
lint
typecheck
unit tests
build
security checks where applicable
browser/E2E tests where applicable
preview deployment
smoke test
```

No AI worker may declare a change shippable if the deterministic gate fails.

Where a repository lacks adequate tests, the first engineering-autonomy work should improve observability and testability before increasing merge authority.

---

## 17. PR-first autonomy

For code changes, the default architecture should be:

```text
Evidence-backed issue
      |
      v
Engineering Bot/agent
      |
      v
Branch + change
      |
      v
Deterministic CI
      |
      v
Independent QA Bot
      |
      v
Preview verification
      |
      v
Merge gate
```

Initially, owner/human approval remains required for merge and production promotion.

Later, low-risk classes may become auto-merge eligible only if:

- branch protection remains active;
- required CI passes;
- independent QA passes;
- change classification is inside pre-approved scope;
- no sensitive config/security/payment/auth schema is touched;
- rollback exists;
- production smoke check runs.

Do not allow an AI agent to remove the guardrails that govern the AI agent.

---

# Part VIII — Business automation beyond engineering

## 18. Event-driven work replaces prompt-driven work

The target architecture is not:

```text
Owner notices something -> owner prompts Bot
```

It is:

```text
Approved event -> workstream run -> executor -> verification -> result/exception
```

Potential event sources:

- scheduled cadence;
- GitHub issue/PR/CI event;
- database event;
- application error;
- new customer/signup event;
- support event;
- revenue/payment event;
- product-data change;
- CRM state change;
- owner instruction.

Do not connect an event directly to an unrestricted agent. Route it through the relevant Delegation Spec and authority policy.

---

## 19. Closed-loop experiment system

Every automated business-improvement process must have a stop condition and measurement.

Bad routine:

> Publish an article every day.

Acceptable loop:

1. Diagnose acquisition constraint.
2. Form hypothesis.
3. Record baseline.
4. Choose smallest experiment.
5. Define primary metric and guardrails.
6. Implement.
7. Verify implementation.
8. Observe for an appropriate window.
9. Interpret result.
10. Keep, revise, roll back, or stop.
11. Record lesson.

Agents should not indefinitely generate activity when the evidence says the activity is not working.

---

# Part IX — Cost and control

## 20. Give agents budgets

Autonomous work without cost limits can create silent waste.

Each workstream should eventually have:

- maximum AI/model spend per run;
- maximum human effort before escalation;
- maximum retries;
- maximum browser/computer-use attempts;
- maximum external API cost;
- maximum parallel jobs;
- time budget;
- owner approval threshold for additional spend.

Do not invent arbitrary universal dollar limits. Establish them from real unit economics by workstream.

The Portfolio Manager should report budget anomalies.

---

## 21. Measure real human labor

Do not claim automation savings from task counts.

Track:

- owner minutes required;
- operator minutes required;
- specialist minutes required;
- AI cost;
- infrastructure/API cost;
- correction minutes;
- exception minutes;
- QA minutes.

The thesis succeeds only if repeated mature workstreams require less total coordination and delivery labor without quality deterioration.

---

# Part X — Security design

## 22. Credential isolation

Do not use a shared Bot workspace as the security boundary for unrelated customer tenants.

For the owner's internal portfolio, shared portfolio tooling may be acceptable when the owner intentionally accepts that trust boundary.

For Delegation Cloud customers, use tenant-scoped credentials and tools:

- scoped OAuth;
- tenant-specific service accounts;
- secrets inaccessible to other tenants;
- least-privilege scopes;
- logged access;
- revocable authority grants;
- separate execution environments where the risk requires it.

Grok Bot or any other agent can be an executor only after Delegation Cloud has established the tenant's allowed tool surface.

---

## 23. Circuit breakers

Every autonomous workstream needs one or more stop conditions.

Examples:

- unexpected response schema;
- integration authentication failure;
- repeated failure count;
- sudden volume anomaly;
- cost anomaly;
- conflicting source data;
- low confidence where confidence is relevant;
- failed verification;
- policy/authority mismatch;
- unusually consequential entity/value;
- source freshness failure.

When the circuit opens:

1. stop execution;
2. preserve state and evidence;
3. create exception;
4. downgrade autonomy if appropriate;
5. notify the correct human role;
6. do not brute-force through the boundary.

---

# Part XI — The first 30 days

## 24. Week 1 — Governance and instrumentation

### Delegation Cloud

- merge or otherwise preserve this strategic documentation after review;
- design the first implementation increment for `DelegationSpec`, `WorkstreamRun`, `EvidenceArtifact`, `OutcomeReceipt`, `ExceptionCase`, and `AutonomyProfile`;
- do not yet redesign the entire product UI;
- preserve existing PR #7/release constraints;
- identify the minimum internal portfolio dashboard required to see workstream state.

### Portfolio

For each active repo:

- confirm governing `VISION.md` exists and is current;
- create `CURRENT_STATE.md`;
- create `KPI_TREE.yaml` with only sourceable metrics;
- create `AUTHORITY_MATRIX.yaml`;
- choose exactly one initial workstream;
- define its Delegation Spec.

### Grok Bot

Create the four initial Bots:

- Portfolio Manager;
- Engineering Worker;
- QA Worker;
- Growth/Market Worker.

Keep all external action prepare-only.

---

## 25. Week 2 — Run everything manually once

Do not schedule yet.

Run:

- Loadout Catalog Integrity;
- Grounded Supplier & Catalog Integrity;
- Manipulation Score Evidence Base Maintenance;
- Three White Lights Release Quality review;
- CareReserve Market Intelligence review;
- Delegation Cloud Executive Follow-Through.

For each run capture:

- time;
- inputs;
- agent steps;
- human corrections;
- missing permissions;
- false positives;
- exceptions;
- evidence quality;
- owner minutes;
- useful outcome produced.

Revise the Delegation Spec after the run.

---

## 26. Week 3 — Repeat and codify

Repeat the workstream with the revised spec.

If a Grok Bot procedure is now stable:

- convert it into a reusable skill/routine;
- keep execution manual or explicitly initiated;
- compare second-run performance to first-run performance.

Implement deterministic helpers for obvious repeated steps instead of asking the agent to repeat them manually.

Example:

If broken-link checking is deterministic, write a link checker rather than repeatedly instructing Grok Bot to browse every URL.

---

## 27. Week 4 — Schedule observe/prepare routines

Only schedule routines whose first two or more executions were understood and corrected.

Good scheduled routines:

- daily portfolio status review;
- weekly catalog-integrity report;
- weekly research scan;
- CI/release health summary;
- weekly CareReserve market-intelligence delta report.

Still require approval for:

- external communication;
- production merge/promotion;
- pricing change;
- purchasing;
- new vendor commitment;
- sensitive database/access changes.

At the end of Week 4 produce the first portfolio autonomy report.

---

# Part XII — Days 31–90

## 28. Month 2 — Introduce controlled execution

Pick the safest successful workstream, likely Loadout Catalog Integrity.

Allow a narrowly specified reversible action after review.

Examples might include:

- create issue automatically;
- create PR automatically;
- update an internal non-sensitive record;
- mark a source record stale;
- queue a correction for review.

Require:

- independent verification;
- evidence artifact;
- rollback path;
- action log.

Do not increase autonomy merely to hit a timeline.

---

## 29. Month 2 — Add outcome receipts and economics

Every workstream run should now report:

- result;
- verification;
- exceptions;
- owner touches;
- human minutes;
- AI/tool cost;
- observed defects;
- whether the run would have been safe unattended.

Start comparing first, fifth, and tenth runs where enough runs exist.

---

## 30. Month 2 — External design partners only if internal proof exists

Do not market “autonomous business operations” before the product has clean internal evidence.

If internal Founder Follow-Through workstreams are functioning, recruit a very small design-partner cohort from the target ICP.

Preferred ICP:

- founder-led digital service business;
- recurring operational/admin work;
- existing email/calendar/CRM stack;
- meaningful founder coordination burden;
- willing to begin read-only/prepare-only;
- not primarily healthcare/legal/regulated finance;
- not requiring funds custody.

The goal is learning, not volume.

---

## 31. Month 3 — Certify the first workstream

A workstream earns “certified” status only when:

- input requirements are explicit;
- definition of done is measurable;
- common exceptions are mapped;
- evidence and QA exist;
- authority limits are explicit;
- costs are measured;
- repeated execution shows meaningful consistency;
- rollback/escalation exists.

Certification does not imply full autonomy.

---

## 32. Month 3 — Promote one action class

Choose one proven low-risk action and allow it to run without per-run approval inside explicit bounds.

Measure whether:

- owner touches decline;
- QA remains stable;
- exceptions are caught;
- no authority violations occur;
- delivery cost declines.

If quality worsens or exceptions increase materially, demote the workstream.

---

# Part XIII — Portfolio reporting

## 33. Owner brief format

The final operating experience should move toward a decision-oriented brief such as:

```text
PORTFOLIO BRIEF

Loadout
Healthy.
Catalog Integrity completed.
2 changes verified, 1 ambiguity escalated.
No owner action.

Grounded
Watch.
Supplier return policy changed.
No storefront change made.
Decision packet prepared.

Manipulation Score
Healthy.
Research scan complete.
1 paper merits review; no framework change made.

Three White Lights
Blocked on human validation.
Regression fixed and tests pass.
Game-feel playtest required.

CareReserve
Healthy internally.
3 employer briefs prepared.
External outreach remains approval-gated.

Delegation Cloud
PR/release status unchanged unless explicitly changed.
Founder Follow-Through report complete.

OWNER DECISIONS REQUIRED
1. Grounded supplier policy response.
2. Three White Lights game-feel validation.
```

The Portfolio Manager should not disguise uncertainty. If data is unavailable, say so.

---

# Part XIV — Success and failure criteria

## 34. What success actually means

The portfolio-automation program is working if, over time:

- the owner initiates fewer routine prompts;
- more work begins from events or schedules;
- repeated workstreams require fewer clarifications;
- owner decision packets become smaller and higher-value;
- deterministic automation replaces repeated browser/manual agent work;
- human minutes decline on repeatable work;
- QA stays stable or improves;
- exceptions become better classified;
- gross margins improve where the business has revenue;
- business progress remains aligned with each repo's `VISION.md`.

It is not success if Bots merely create more issues, content, reports, or commits.

---

## 35. What this system cannot guarantee

No part of this architecture guarantees:

- product-market fit;
- revenue growth;
- profitable customer acquisition;
- supplier reliability;
- investment returns;
- business survival;
- regulatory acceptance;
- autonomous strategic judgment comparable to an excellent human executive.

Agents can increase throughput and reduce coordination burden. They can also accelerate bad strategy if the control system is poor.

The owner must retain authority over mission, major capital allocation, material pricing/business-model changes, contracts, high-risk external commitments, and strategic pivots until there is a specific reason to delegate part of that authority.

---

# Part XV — Immediate sequence from this document

## 36. Exact next actions

Execute in this order:

1. Review and merge the strategic-docs PR when satisfied; do not mix it with production readiness PR #7.
2. Create a Delegation Cloud implementation issue for the first `Delegation Spec + Workstream Run + Outcome Receipt` vertical slice.
3. Build that vertical slice before building a large autonomous-portfolio dashboard.
4. Add the standard governance package to Loadout first.
5. Define Loadout Catalog Integrity as the first complete Delegation Spec.
6. Create/configure the four initial Grok Bots with minimum permissions.
7. Run Loadout Catalog Integrity manually through Grok Bot once.
8. Record corrections and missing evidence.
9. Add deterministic helpers for repeated mechanical checks.
10. Repeat the workstream.
11. Only then schedule observe/prepare routines.
12. Add Grounded as the second internal tenant/workstream.
13. Add Manipulation Score.
14. Add Three White Lights with explicit human-playtest gate.
15. Add CareReserve last because its external authority boundary is stricter.
16. Use Delegation Cloud itself as a tenant for Executive Follow-Through throughout the process.
17. At 30 days, compare actual owner touches and human minutes to baseline.
18. At 60 days, promote one narrow reversible action only if evidence supports it.
19. At 90 days, decide whether the economics show a path toward reusable managed execution or merely an AI-assisted service business.
20. If the thesis fails, narrow or change it. Do not preserve the story at the expense of the evidence.

---

# Part XVI — Tooling decision record

## 37. Current recommended stack

### GitHub

Source code, versioned operating doctrine, issues, PRs, CI, review and change history.

### Vercel

Existing application host and deployment infrastructure for the Next.js businesses; use durable application workflows where they improve reliability instead of recreating them inside a browser agent.

### Supabase

Database, auth, RLS, tenant state, events, queues/cron where appropriate, and structured Delegation Cloud execution records.

### Grok Bot

Initial persistent AI worker layer for portfolio coordination, engineering support, QA support, and market/research routines. Use it because it can maintain cloud-side working context and execute recurring procedures, but do not treat shared Bot workspaces as tenant security isolation.

### Grok/xAI, GPT, Claude, Gemini, or other models

Treat models as replaceable reasoning/execution components. Benchmark on actual workstream quality and cost.

### OpenRouter or Vercel AI Gateway

Use only where multi-model routing provides real economic, reliability, or quality benefit. Do not add an abstraction layer simply because it exists.

### Hermes

Revisit if Delegation Cloud needs deeper self-hosting, isolated agent profiles/environments, custom orchestration, or model independence beyond what Grok Bot provides. Do not introduce Hermes until Grok Bot or the current stack creates a specific limitation worth solving.

### Replit

Useful for isolated prototypes or experiments. No current reason to re-platform the existing GitHub/Vercel/Supabase portfolio merely to gain another coding agent.

---

# Final operating principle

The purpose of this program is not to make the portfolio look autonomous.

It is to make the portfolio require **less owner coordination while producing more verified useful work**.

The discipline is:

> **Observe before acting. Prepare before executing. Verify before declaring done. Automate only what has been understood. Increase autonomy only when evidence earns it. Keep humans where judgment still matters.**

If that process works repeatedly across the portfolio, Delegation Cloud gains real evidence for the product it intends to sell. If it does not, the failure data should change the strategy before the company scales the wrong architecture.

---

## Current external documentation to re-check during implementation

Because agent and infrastructure products change rapidly, implementation work should verify current vendor documentation instead of relying on this August 2026 snapshot.

- xAI Grok Bot: https://docs.x.ai/grok-bot/overview
- Grok Bot skills/routines: https://docs.x.ai/grok-bot/skills-routines-and-automations
- Grok Bot security/approvals: https://docs.x.ai/grok-bot/approvals-security-and-privacy
- Vercel Workflow: https://vercel.com/docs/workflow
- Supabase Queues: https://supabase.com/docs/guides/queues
- Supabase Cron: https://supabase.com/docs/guides/cron
- GitHub Actions: https://docs.github.com/en/actions
