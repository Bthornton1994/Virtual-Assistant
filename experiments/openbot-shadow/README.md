# OpenBot shadow experiment

This directory defines the Phase 0 boundary for evaluating OpenBot as a replaceable, prepare-only `evidence_research` executor.

It does not install or deploy OpenBot.

## Artifacts

- `policy.json`: OpenBot `AGENT_COMPUTER_POLICY` payload. Enforce mode, navigate/read only, default deny.
- `adapter-contract.schema.json`: strict assignment/result boundary between Delegation Cloud and the OpenBot adapter.
- `../../docs/OPENBOT-SHADOW-PILOT.md`: authority, security, economics, benchmark, graduation, and stop conditions.
- `../../supabase/qa/openbot_shadow_executor_profile.sql`: idempotent QA-only profile declaration. It is committed for review and is not applied by this phase.

Pinned OpenBot source:

- version: `v0.0.4`
- commit: `6826e11afd52f03c30af2d873203792acad95f63`

Pinned policy SHA-256:

`06759cfc784d9b00d631370063f40946e8cac01bd4df72c1d4955bd9ab38216a`

## Non-negotiable invariants

- OpenBot is an implementation, not the control plane.
- Runs 4 through 9 remain unchanged.
- Every test uses a new immutable Gauntlet attempt.
- Only public, non-customer catalog inputs may enter the lab.
- The model is offered exactly `computer_navigate`, `computer_read`, and `computer_snapshot`.
- The model may navigate and read. Every other computer intent is refused.
- Secret requests, help requests, human takeover, and delegated human input are prohibited because the pinned upstream control paths are not CEL policy-gated.
- OpenBot output is untrusted until Delegation Cloud parses and validates it.
- A failed result is retained and is never repaired within the same attempt.
- CopilotKit thread or memory state is never authoritative.
- There is no Production, live Supabase, or Vercel configuration work in Phase 0.

## Before a local run

A future lab operator must record all of the following before creating an assignment:

- exact OpenBot commit;
- external PostgreSQL topology;
- loopback/private-network bindings;
- computer runtime;
- empty browser-profile identity;
- model provider and exact model ID;
- policy hash;
- full non-secret configuration hash;
- economic ceiling;
- deadline;
- a captured model-tool inventory containing exactly `computer_navigate`, `computer_read`, and `computer_snapshot`;
- confirmation that MCP, shell, files, private hosts, direct computer endpoints, human secret entry, human takeover, customer credentials, and customer data are absent.

The operator must put those values in the assignment's `executorConfigurationSnapshot`. Placeholder values do not qualify a run.

## Validate repository artifacts

From the Delegation Cloud repository root:

```bash
sha256sum experiments/openbot-shadow/policy.json
node -e 'JSON.parse(require("node:fs").readFileSync("experiments/openbot-shadow/policy.json", "utf8"))'
node -e 'JSON.parse(require("node:fs").readFileSync("experiments/openbot-shadow/adapter-contract.schema.json", "utf8"))'
npm test -- src/lib/__tests__/openbot-shadow-pilot.test.ts
```

The expected policy hash is `06759cfc784d9b00d631370063f40946e8cac01bd4df72c1d4955bd9ab38216a`.

These checks validate the repository contract. They do not prove that an OpenBot deployment enforces it. Runtime enforcement must be verified in the isolated lab by attempting each prohibited intent and confirming a refusal plus a corresponding audit event. Separately, preflight must prove that secret/help/takeover tools are absent, because those control paths are not covered by the pinned CEL policy engine. If they are present, do not run a model.
