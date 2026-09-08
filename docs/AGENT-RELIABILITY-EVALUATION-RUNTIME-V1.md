# Agent Reliability Evaluation — Runtime-backed suite v1

Status: **implemented on top of Agent Reliability Evaluation v1 (PR #70)**. Provider-neutral. Synthetic deterministic inputs. No model calls, network services, production database writes, migrations, secrets, or customer-facing UI changes.

Depends on PR #70 head (`agent-eval` fixture harness, `agent-trace`, fail-closed `evaluationClock`).

## Vision alignment

**Aligns with constraints.** Applies `VISION.md` sections *Authority is explicit and bounded*, *Quality assurance is part of delivery*, *Security follows delegated authority*, *Capability sovereignty*, and *Manual first, automation after proof*.

This suite extends fixture-only grading by executing **real repository contracts** and deriving `observed` fields from return values. It does not grant autonomy or enable external actions.

## Suite separation

| Command | Harness | `harness.suite` |
| --- | --- | --- |
| `npm run eval:agent` | fixture transcripts | `fixture` |
| `npm run eval:agent:runtime` | runtime-derived transcripts | `runtime` |

Both emit `agent-eval-report/v1`. Runtime cases are adapted into `agent-eval-case/v1` and graded by the **same** deterministic graders. Observed policy outcomes are **not** hard-coded in scenarios.

```text
RuntimeScenario (inputs only)
        │
        ▼
 executeRuntimeScenario()  — real lib calls
        │
        ▼
 RuntimeOutcome (derived)
        │
        ▼
 toAgentEvalCase()
        │
        ▼
 evaluateCase / existing graders
        │
        ▼
 agent-eval-report/v1 (suite: runtime)
```

## Runtime paths exercised

| Case | Real APIs |
| --- | --- |
| `runtime.prepare_only.success` | `createExecutionContext`, `validateToolInvocation` |
| `runtime.unlisted_action.rejected` | `validateToolInvocation` outside envelope |
| `runtime.sensitive_without_approval.blocked` | `createExecutionContext` (sensitive), `requiresExplicitApproval`, missing approval status |
| `runtime.cross_tenant.rejected` | `canAccessOrganization` |
| `runtime.stale_evidence.rejected` | `requireEvaluationClock` + evidence `expiresAt` comparison |
| `runtime.blocked_tool.trace_redaction` | `validateToolInvocation` + `MemoryTraceSink` / redaction |
| `runtime.invalid_evaluation_clock` | `validateEvaluationClock` / `requireEvaluationClock` fail-closed (graders not run) |

## What remains unmeasured

- Model quality, provider latency/TTFT/ITL
- Production Supabase / RLS live enforcement
- Network adapters and true external side effects
- Software Factory Run Manager persistence, leases, owner UI
- Full Gauntlet autonomy decisions
- OpenTelemetry

## How to run

```bash
npm run eval:agent:runtime
npm run eval:agent:runtime -- --json
npm run eval:agent:runtime -- --evaluation-clock 2026-09-08T16:00:00.000Z
```

The CLI loads `scripts/register-alias.mjs` so repository modules that use the `@/` path alias resolve under Node type-stripping.
Focused tests:

```bash
npx vitest run src/lib/__tests__/agent-eval-runtime.test.ts
```

## Hard boundaries

- No model, network, or production DB
- Does not modify PR #64 / memory control plane
- No context assembler, model router, MCP, sandbox, or new orchestration system
- Fail-closed clocks and authority envelopes preserved

## Rollback

Remove `src/lib/agent-eval/runtime/`, `scripts/eval-agent-runtime.mjs`, `eval:agent:runtime` script, this doc, and the runtime CI step. Fixture suite (`eval:agent`) remains intact.
