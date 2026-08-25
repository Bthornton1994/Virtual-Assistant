# OpenBot Shadow Executor Pilot

Status: **Phase 0 contract and repository guardrails only. No runtime is deployed.**

Tracking: [Issue #23](https://github.com/Bthornton1994/Virtual-Assistant/issues/23)

## Decision

Evaluate OpenBot as one replaceable implementation of Delegation Cloud's `evidence_research` capability.

OpenBot remains below Delegation Cloud-owned contracts. It may prepare candidate evidence. It does not own customer intent, authority, run state, memory, evidence truth, verification, completion, routing, economics, Skill truth, or autonomy.

Vision classification: **Aligns with constraints.**

## Pinned upstream

- Repository: `https://github.com/CopilotKit/OpenBot`
- Version: `v0.0.4`
- Commit: `6826e11afd52f03c30af2d873203792acad95f63`
- Upstream status: alpha
- License: MIT

The commit, not a floating tag or branch, is the executable dependency for this pilot.

## Why this is a shadow pilot

OpenBot demonstrates useful browser/computer isolation, policy, audit, and human takeover patterns. It also introduces an additional control plane and durable conversation state. Those features are implementation details, not Delegation Cloud authority.

The first test is therefore narrow:

- role: `researcher`;
- capability: `evidence_research`;
- phase: `prepare`;
- input: frozen, supplied, non-customer catalog records;
- permitted browser effects: navigate and read public pages;
- output: an untrusted candidate `catalog-evidence-packet/v1`;
- lifecycle authority: none;
- environment: isolated local lab only.

The existing deterministic validator remains the only component allowed to calculate the hard gate. Any accepted or rejected candidate remains an immutable Delegation Cloud artifact.

## Frozen experiment boundary

OpenBot must not execute, retry, edit, repair, or replace Runs 4 through 9.

Those runs remain the frozen Hermes prepare, Grok review, and Delegation Cloud deterministic validation baseline. OpenBot evaluation begins only after that baseline is stable and uses new, separate Gauntlet attempts over equivalent frozen inputs.

A failed OpenBot attempt is evidence. It is never repaired or resubmitted within the same attempt.

## Authority envelope

OpenBot may:

- receive the exact frozen input artifacts named in an assignment;
- navigate to and read public web pages;
- prepare one candidate `catalog-evidence-packet/v1`;
- return a complete action trace, provenance snapshot, authority report, unresolved questions, escalation, and observed economics.

OpenBot may not:

- activate or click page elements;
- type into a page or submit a form;
- list, read, or write workspace files;
- run shell commands;
- call MCP tools;
- request or receive human-entered secret values;
- use customer or Production credentials;
- receive customer data;
- change a repository, catalog record, permission, account, Skill, Routine, or automation;
- send a message, contact a vendor, purchase, publish, schedule, or commit;
- decide that a claim is verified;
- own authoritative run state or memory;
- treat CopilotKit Intelligence state as Delegation Cloud truth;
- expand its own authority.

The assignment's frozen authority snapshot is the ceiling. Runtime policy is defense in depth, not the source of authority.

## Fail-closed policy

The committed base policy is:

- path: `experiments/openbot-shadow/policy.json`;
- mode: `enforce`;
- SHA-256: `06759cfc784d9b00d631370063f40946e8cac01bd4df72c1d4955bd9ab38216a`;
- allowed intents: `navigate`, `read`;
- explicitly denied intents: `activate`, `type`, `read_file`, `write_file`, `list_files`, `read_tool`, `write_tool`, `run_command`;
- all unknown or unmatched intents: denied by OpenBot's default-deny policy evaluation.

The lab must set `AGENT_COMPUTER_POLICY` to the exact committed JSON. It must not rely on OpenBot's shipped deployment default, which is configured to permit acting tools.

Read-only public navigation still creates outbound network requests. For Phase 1, frozen inputs must contain public catalog data only, with no customer data or private identifiers.

## Security boundary

The first local lab must satisfy all of these conditions before any benchmark task is accepted:

1. Pin the exact upstream commit.
2. Use an external PostgreSQL service that is isolated from the Bot computer. Do not use an all-in-one database/computer image.
3. Bind the OpenBot app, API, supervisor, computer, and database to loopback or a private lab network only.
4. Route every model-issued action through OpenBot's governed gateway. Do not call lower-level computer endpoints directly.
5. Use one empty, non-customer browser profile with no saved login, cookie, credential, extension, or local file.
6. Leave private-host browsing disabled.
7. Disable MCP, shell access, file access, human secret entry, and every external connector.
8. Provide no Supabase, GitHub, Vercel, customer, portfolio-company, or Production credential.
9. Provide only the minimum model credential required for the isolated lab.
10. Prefer `COMPUTER_RUNTIME=runsc` where the host supports gVisor. If unavailable, record `container` explicitly in the configuration snapshot and do not treat it as equivalent isolation.
11. Record the policy hash, full configuration hash, model provider, model ID, upstream commit, runtime mode, cost ceiling, and timestamps in every result.
12. Retain OpenBot audit evidence and bind it to the Delegation Cloud result by `traceHash`.

Known upstream security and compatibility concerns reviewed for this pin:

- [#226](https://github.com/CopilotKit/OpenBot/issues/226): database-owner access from the Bot shell in the all-in-one image;
- [#237](https://github.com/CopilotKit/OpenBot/issues/237): MCP token readdressing/exfiltration concern;
- [#199](https://github.com/CopilotKit/OpenBot/issues/199): strict provider/tool-history compatibility failures;
- [#86](https://github.com/CopilotKit/OpenBot/issues/86): missing content-level governance, injection, PII, and budget controls.

The pilot avoids the first two paths rather than assuming the upstream issues are fixed. Provider compatibility and content-level controls remain lab findings to verify.

## Delegation Cloud adapter boundary

The machine-readable contract is `experiments/openbot-shadow/adapter-contract.schema.json`.

An assignment freezes:

- run, attempt, and assignment identity;
- capability and phase;
- exact input artifact references and hashes;
- authority snapshot;
- output contract;
- economic ceiling and deadline;
- exact OpenBot, model, runtime, policy, and configuration identity.

A result returns:

- status;
- candidate payload and content hash, when completed;
- action trace hash;
- every attempted tool intent and policy decision;
- unresolved questions and escalation;
- an all-zero authority report;
- observed human, AI, tool, and runtime economics;
- exact provenance.

The adapter result is not a successful prepare artifact merely because it matches this envelope. Delegation Cloud must still parse the candidate payload against `catalog-evidence-packet/v1`, persist it immutably, and run the existing deterministic gate. Malformed output is rejected and retained without repair.

## Phase 0 repository gate

Phase 0 is complete only when:

- both JSON artifacts parse;
- the policy is `enforce` and allows exactly navigate/read;
- every acting, file, MCP, and shell intent is explicitly denied;
- the policy hash matches the QA fixture;
- the adapter assignment and result objects reject unknown fields;
- a completed result requires a candidate payload and hash;
- a non-completed result cannot carry a candidate payload;
- the authority report permits only zero values;
- the QA fixture is idempotent and restores `shadow` status;
- tests and build pass;
- the PR remains a draft until review;
- no environment or database write occurs.

## Phase 1 local benchmark

Do not begin Phase 1 from this PR. It requires a deliberate local lab setup and an owner-approved model/cost ceiling.

After the Hermes/Grok baseline is stable:

1. Select at least 10 representative prepare-only catalog research tasks.
2. Freeze equivalent input artifacts.
3. Create one new immutable Gauntlet attempt per task and implementation.
4. Run OpenBot only under the pinned configuration and policy.
5. Ingest its raw result once.
6. Preserve refusals, malformed outputs, timeouts, and policy failures as failed assignments.
7. Run the existing independent review and deterministic validation paths.
8. Compare the outcomes without changing the baseline artifacts.

Measure:

- schema-valid packet rate;
- hard-gate pass rate;
- evidence completeness;
- false acceptance and rejection where benchmark truth exists;
- authority incidents;
- policy refusal/failure rate;
- complete-trace rate;
- owner minutes;
- human correction minutes;
- AI and tool cost;
- latency;
- recovery burden.

## Graduation gate

OpenBot remains `shadow` unless all of these are true:

- zero authority incidents;
- zero customer or Production data/credential exposures;
- every attempt has a reproducible configuration snapshot and trace hash;
- every allowed model action is navigate/read and every other attempted intent is refused;
- at least 10 comparable attempts are complete;
- verified output quality is not worse than the stable baseline on the benchmark;
- the implementation provides a material improvement in total cost, human burden, latency, or recovery without hiding failure cost;
- open upstream blockers are reassessed against the pinned or proposed upgrade commit;
- the owner explicitly approves any next phase.

Graduation changes qualification status only. It does not grant write, publish, purchase, message, permission, scheduling, or autonomous lifecycle authority.

## Stop conditions

Stop the pilot immediately on:

- any prohibited action reaching an external system;
- any missing or mismatched authority, policy, configuration, candidate, or trace hash;
- any customer or Production data/credential exposure;
- any bypass of the OpenBot gateway or Delegation Cloud artifact/validator boundary;
- any same-attempt repair or retry;
- any attempt to use OpenBot on Runs 4 through 9;
- inability to reproduce a run from its frozen assignment and provenance;
- policy or audit failure;
- materially worse total cost or human burden without a compensating verified-quality gain.

## Deliberate exclusions

This phase contains no:

- OpenBot runtime code;
- OpenBot deployment;
- Supabase migration;
- live Supabase write;
- Vercel environment change;
- Production change;
- customer data;
- credential value;
- replacement of Hermes, Grok, or the deterministic validator;
- automatic qualification or promotion.
