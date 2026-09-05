# Software Factory Model Economy v1

Status: **control-plane policy. No production deploy. No secrets. No merge authorization.**

Vision alignment: **Aligns with constraints.** Relevant `VISION.md` sections: *Use the right executor for each step*, *Capability sovereignty*, *Authority is explicit and bounded*, *Quality assurance is part of delivery*, and *Manual first, automation after proof*.

These pins are Software Factory routing policy and implementation provenance. They are not durable workstream semantics. A workstream still asks for implement or plan; it does not become “the Grok workstream” or “the Claude workstream.”

## Purpose

Establish the canonical Software Factory model-economy in this repository’s control plane so implementer cost stays the default and expensive strategic planners stay rare, read-only, and human-selected.

This document does not qualify a model as an executor, grant authority, or change Delegation Specs, Gauntlet gates, or Outcome Receipts.

## Pins

| Role | Model ID | How it is used |
| --- | --- | --- |
| Default implementer | `grok-4.6` | Ordinary Software Factory implementation |
| Strategic planner | `claude-fable-5-1` | Rare, read-only, manually invoked |
| Strategic planner | `gpt-5.6-sol` | Rare, read-only, manually invoked |

Choose **exactly one** planner when escalation is justified. Never launch both planners by default. Never treat a planner as a second implementer.

Project agent files:

- `.cursor/agents/sf-implementer.md`
- `.cursor/agents/sf-planner-claude.md`
- `.cursor/agents/sf-planner-gpt.md`

Do not add more Software Factory agents unless an owner decision changes this policy.

## No automatic planner delegation

Planner files exist so an operator can invoke one of them by name. They are not an auto-router.

Do not write or follow automatic-delegation language for these planners, including:

- “use proactively”
- “always use”
- “every task”
- “run before implementation”
- “run after every change”

A parent agent must not spawn a planner because the task is large, interesting, or “would benefit from a plan.” Ordinary planning, scoping, and sequencing stay with the implementer.

## Escalation criteria

A planner may be used only when a human has already selected exactly one planner **and** at least one of these is true:

1. Architectural ambiguity that the implementer cannot resolve from existing repo contracts
2. Cross-repository coordination
3. Security-sensitive design or review
4. High-risk change
5. Authority, permissions, data, economics, or core simulation questions
6. Major stage or product decision
7. Missing execution sequence that blocks a safe implementer start
8. Substantial rework risk if the wrong approach is coded first

If none apply, record `PLANNER_ESCALATION: NOT REQUIRED` and continue on `grok-4.6`.

## Verification

Verification is the existing Software Factory process. Planners are not a routine verify step.

When code or product behavior changes, use the repository’s existing checks (`npm run verify` or the equivalent lint, typecheck, test, and build commands). When a Software Factory run manager is present, keep hashed evidence, packet acceptance criteria, required evidence kinds, and owner acceptance outside the executor. A planner opinion is not an Outcome Receipt, CI result, or acceptance gate.

Do not invoke a planner to “check the work,” re-review an ordinary diff, or replace tests.

## Task report contract

Every Software Factory task report must include:

| Field | Value |
| --- | --- |
| `REQUESTED_MODEL` | Model the packet or operator asked for |
| `ACTUAL_MODEL` | Model that actually ran |
| `PLANNER_ESCALATION` | One listed criterion and a one-line reason, or `NOT REQUIRED` |
| `MODEL_ROUTING_EXCEPTION` | Omit unless the requested model was unavailable or overridden. Then name the requested model, the fallback, and why |

If `REQUESTED_MODEL` and `ACTUAL_MODEL` differ, `MODEL_ROUTING_EXCEPTION` is required.

## Authority

This policy does not authorize merge, Production deploy, Production database or environment writes, secret creation or rotation, purchases, external messages, permission changes, or autonomy increases.

Model names here are replaceable pins. Historical evidence remains valid if a later owner decision changes the default implementer or the planner pair.

## Capability classification

1. **Capability:** Software Factory implement-versus-plan model routing
2. **Treatment:** Native control-plane policy; models remain replaceable implementations
3. **Swap test:** Another implementer or planner can satisfy the same calling contract without redesigning the workstream
4. **Authority:** Delegation Cloud retains lifecycle, verification, and economics; these files do not own state
5. **Measurement:** Requested-versus-actual model and escalation fields are inspectable in task reports
6. **Removal:** Retiring the pins does not invalidate hashed historical evidence
