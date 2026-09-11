# Design contract

This file is the compact, agent-readable entry point for interface work in this repository. It complements `docs/DESIGN_ENGINEERING.md`; it does not replace `AGENTS.md`, `VISION.md`, safety, privacy, methodology, data, or release documentation.

## Product intent

Delegation Cloud is a clear, trustworthy front door for managed work and verified outcomes. Preserve the current information architecture, direct calls to action, capability states, and visible boundaries around preparation, human review, and authority.

## Design principles

- Start with the existing product surface, tokens, primitives, and information architecture. Remove or correct the highest-impact supported problem before adding visual novelty.
- Keep one coherent visual idea per surface. Do not import a generic AI aesthetic, a copied brand system, or a fixed visual preset.
- Make hierarchy, interaction state, and next action legible through spacing, type, semantic color, and composition.
- Keep visible copy direct, specific, and truthful. Do not add invented proof, metrics, testimonials, partners, outcomes, or urgency.
- Design the complete state set: loading, empty, error, disabled, focus, keyboard, narrow viewport, and reduced motion.

## Brand direction

The current visual direction is documented in `BRAND.md`: **Operational Signal**, a midnight-blue service rail around pale work surfaces with teal movement and amber authority signals. Keep this direction distinct from consumer SaaS gradients, freelancer marketplaces, and generic AI dashboards. The brand layer may change hierarchy, color, type, and material cues, but it must not change authority, access, QA, or capability boundaries.

## Responsive and accessibility gate

Before handoff, inspect the actual rendered surface at the repository's supported viewports, including narrow mobile and wide desktop states. Check:

- readable type hierarchy, wrapping, overflow, and tabular numbers where values are compared;
- keyboard order, accessible names, focus visibility, touch targets, contrast, and reduced-motion behavior;
- loading, empty, error, disabled, and recovery states;
- whether the primary task remains visible without unnecessary scrolling or a persistent panel blocking content.

## Project guardrails

- Do not present proposed capabilities, automation, or outcomes as active or guaranteed.
- Do not add premature autonomy, external actions, customer data access, or production authority through UI changes.
- Keep authentication, organization, delegation, and work-status states explicit and recoverable.

## Source discipline

The `DESIGN.md` pattern is informed by [Refero Styles](https://styles.refero.design/), [getdesign.md](https://getdesign.md/), [OpenDesign](https://github.com/nexu-io/open-design), and [awesome-design-md](https://github.com/VoltAgent/awesome-design-md). Those are catalogs and tooling references, not authorities for this product.

Do not copy external brand assets, hosted templates, generated claims, or third-party components into this repository without a separate review. This file is the local design contract; project-specific documentation and fresh verification evidence remain authoritative.

## Verification

Run the repository's documented lint, typecheck, test, and build checks relevant to the change. Report visual verification separately from automated checks. Do not claim completion when a required check is pending or failed.
