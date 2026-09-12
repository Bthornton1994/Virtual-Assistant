# External skill routing and Project delegation policy

Date: 2026-09-12
Status: applied as a central routing record; no external repository is added as a runtime dependency.

This document reassesses the nine public repositories supplied for the developer, design, marketing, and social-media workflow. It records the smallest useful extraction and routes it to Cursor Projects instead of creating one new always-on bot per capability.

## Repository revisions checked

| Source | Checked revision | Primary extraction |
| --- | --- | --- |
| obra/superpowers | b36e0829c6d0140e93cfef2ca599b1b07d4a7797 | Planning, TDD, debugging, review, verification |
| upstash/context7 | 6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e | Version-specific documentation lookup |
| anthropics/skills | 34040c9c568585f6929bedeaad110ad08f079624 | Webapp testing and skill-creation patterns |
| thedotmack/claude-mem | main checked from current repository | Optional persistent memory experiment |
| nextlevelbuilder/ui-ux-pro-max-skill | 7f69fed6a2717900085f1bc3b263721f8ba025e2 | Design-system and UX checklists |
| Leonxlnx/taste-skill | ccbc15639c97057cbfcf32ecebc38ef716e4bb37 | Anti-generic design and redesign audit |
| Jakubantalik/transitions.dev | 0b236ec0754fb7408d6291dca52484ecd8e10812 | Reusable motion and reduced-motion patterns |
| coreyhaines31/marketingskills | 5b2c0007766c6a1cf1d53fd8fc73e979e0821022 | Customer research, product marketing, copy, sales enablement |
| charlie947/social-media-skills | d2e948719eafc8ed9e2436357ad18489bb371a81 | Voice, content, social formats, and analytics |

The revisions are references for review. Before vendoring or executing any upstream script, inspect its license, dependencies, network behavior, credentials, and current compatibility.

## Existing extraction found in personal repositories

Virtual-Assistant, Grounded, CareReserve, and Manipulation-score already contain the selected design and verification layer, including design-taste-frontend, redesign-existing-projects, source-driven-development, and verification-before-completion.

The Taste design-taste-frontend file and the Superpowers verification-before-completion file currently match the upstream file content by Git blob SHA in the checked repositories. Do not duplicate them.

The existing policy at docs/EXTERNAL-AGENT-SKILLS.md remains authoritative for those repos.

## Project routing

### StageForge Project

Use now:

- Superpowers verification-before-completion
- Superpowers systematic-debugging
- Superpowers writing-plans
- Superpowers test-driven-development for behavior changes
- Context7 or official documentation
- Anthropic webapp-testing only where it adds coverage

Use later:

- UI UX Pro Max, Taste, and Transitions for customer-facing presentation surfaces only
- Marketing skills after workflow evidence supports a product message

Do not add MCP, editor, marketplace, multi-engine, hosted SaaS, asset downloads, licensing, or general prompt-to-game scope before product proof.

### Three White Lights Project

Use:

- Superpowers bounded engineering and verification
- Anthropic webapp-testing
- UI UX Pro Max
- Taste
- Transitions
- Context7 or official documentation

The TWL Project must resolve the repository's visual source-of-truth conflict before applying design recommendations. The current cross-repo conclusion remains ADAPTER_GAP. No StageForge adapter is authorized by this routing record.

### Virtual-Assistant Project

Use:

- Superpowers planning, debugging, and verification
- Context7 for exact Supabase, Next.js, and Vercel versions
- Anthropic skill-creator patterns for internal skill maintenance
- Existing authority, evidence, approval, and lifecycle documents

Delegation Cloud remains the control plane and system of record. Cursor Projects are repo-level PM/execution surfaces, not replacements for authoritative lifecycle state.

### Grounded, CareReserve, Clarity, and Loadout

Reuse existing repo-local quality skills. Do not install the nine repositories wholesale. Keep current scope decisions and use only bounded maintenance or discovery tasks.

### Shared Growth Project

Use selected marketing skills only:

- customer-research
- competitor-profiling
- product-marketing
- copywriting
- sales-enablement
- pricing

Keep claims evidence-backed. Do not send outreach or publish content without explicit approval.

### Shared Content Project

Use social-media skills later:

- voice-builder
- post-writer
- content-matrix
- post-scorer
- analytics-dashboard

Do not use Apify, Gemini, or other external services without an explicit credential and cost review.

## Bot consolidation

- Software Factory PM, Queue and Dependency Scout, Worktree Control, and the routine Developer coordinator become Cursor Project PM/dispatch/ledger modes.
- Playtest Evidence, Codebase Hygiene, and routine verification become Project tasks.
- Independent review remains fresh-context and separate from implementation.
- Design/Front-End becomes a Project design lane.
- Innovation becomes an occasional Project mode.
- Growth/Market remains one shared low-frequency function.
- Grok CoS remains the portfolio coordinator.
- Grok Build remains a bounded TWL mechanics specialist.
- Fable/Sol remain rare single-planner escalations.
- Claude-Mem is not the source of truth and is not installed by this change.
- Do not create a new bot when a Project mode or existing skill covers the task.

## Usage policy

Routine repository work stays inside Cursor Projects.

Grok receives only:

- A compact kickoff packet
- A compact completion or blocked digest
- A trigger-based escalation for P0/P1, access, scope, evidence, authority, or material cost issues

Do not send full logs, diffs, file inventories, or repeated context to Grok. Link to evidence and provide exact SHA, status, blockers, and next action.

## Authority

These skills and routing records do not authorize merge, deployment, production changes, external messaging, purchases, licensing, permissions, secrets, or business-validation claims. Existing AUTHORITY_MATRIX.yaml, strategy, lifecycle, and release documents remain authoritative.
