# UI design engineering

Virtual Assistant uses a focused, vendored subset of Emil Kowalski's UI skills to make Delegation Cloud feel clear, calm, and operationally trustworthy.

## Source

- Upstream: https://github.com/emilkowalski/skills
- Pinned source commit: `d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7`
- License: MIT, see `docs/EMIL-SKILLS-LICENSE.md`.
- Vendored skills are updated deliberately from the pinned source commit so agent behavior remains reproducible.

## How agents use the skills

- Read this file and `VISION.md` before UI work.
- Read `.claude/skills/emil-design-eng/SKILL.md` for every UI change.
- Use `animate` for a new interaction, `review-animations` for motion review, and `find-animation-opportunities` or `improve-animations` before proposing additional motion.
- Use `pick-ui-library` before adding a third-party UI primitive. Use `prototype` only when multiple materially different directions are needed.

## Delegation Cloud guardrails

- Preserve explicit scope, requested access, approval, logging, and tenant-isolation language.
- Visual refinements must not create or imply autonomous execution, hidden monitoring, or authority beyond the Delegation Spec.
- Keep action surfaces at accessible touch sizes, use spatially consistent transitions, and stop non-essential motion when `prefers-reduced-motion` is enabled.

The vendored files are source material for agents. Project-specific instructions in `AGENTS.md`, `VISION.md`, and the Delegation Spec override them.

## Jakub Krehel interface-quality skills

Virtual Assistant also vendors Jakub Krehel’s interface-quality skills as a complementary, evidence-first layer for accessibility, layout, writing, typography, color, and UI polish.

### Source

- Upstream: https://github.com/jakubkrehel/skills
- Pinned source commit: `267330e1adfc66a718fb65fa6918c1f06d0a689e`
- License: MIT, see `docs/JAKUB-KREHEL-SKILLS-LICENSE.md`.
- The vendored files are updated deliberately from this pinned source commit so agent behavior remains reproducible.

### How agents use the skills

- Read this file and the project’s governing vision and safety documents before UI work.
- Use `better-interface` as the cross-discipline orchestrator and read the owning `better-*` skill for the domain being changed.
- `interface-review`, `explain-interface`, `variant`, and `break` are user-invoked procedures and must not be started implicitly.
- Preserve the project’s existing tokens, component patterns, motion language, and responsive conventions. Measure rendered contrast before proposing a color change.

### Project guardrails

- Preserve explicit outcome, authority, approval, logging, verification, and tenant-isolation language.
- Do not let visual polish imply autonomous authority, hidden monitoring, or execution beyond the Delegation Spec.
- Keep operational forms and status surfaces readable, keyboard-usable, and resilient at narrow widths.

The vendored files are source material for agents. Project-specific instructions in `AGENTS.md`, `VISION.md`, and the existing design-engineering guidance override them.

## Taste skill and redesign guidance

This repository vendors a focused subset of Leonxlnx's `taste-skill` collection for evidence-backed interface refinement.

### Source

- Upstream: https://github.com/Leonxlnx/taste-skill
- Pinned source commit: `ccbc15639c97057cbfcf32ecebc38ef716e4bb37`
- License: MIT, see `docs/LEONXLNX-TASTE-SKILL-LICENSE.md`.
- The pinned core skill is v2 experimental, so agent behavior remains reproducible at this revision.
- Vendored files:
  - `.claude/skills/design-taste-frontend/SKILL.md`
  - `.claude/skills/redesign-existing-projects/SKILL.md`

### How agents use it

- Start with the core skill's design read and the redesign skill's scan, diagnose, and fix sequence.
- Treat an existing surface as preserve-mode unless an owner explicitly approves an overhaul.
- Use the core pre-flight for accessibility, mobile collapse, reduced motion, copy clarity, visual hierarchy, and performance. Do not treat its landing-page patterns as requirements for product surfaces.
- Keep this project's tokens, information architecture, copy voice, data semantics, privacy, safety, and release controls authoritative.

### Project application map

- Design read: preserve-mode marketing experience for founders and technical buyers, with calm operational trust, warm neutrals, deep green, and Geist typography.
- Review dials: DESIGN_VARIANCE 5, MOTION_INTENSITY 3, VISUAL_DENSITY 4 on marketing routes. These describe the current surface and guide proportionate review; they are not permission to replace the product language or layout.
- Scope: Apply the core taste rules to marketing routes and the redesign audit to existing interface components. Operational app and ops dashboards remain product surfaces with their own density and authority requirements, not landing-page canvases.
- Guardrails: Preserve explicit outcome, requested access, approval, logging, verification, and tenant-isolation language. Visual polish must not imply autonomous authority or execution beyond the Delegation Spec.

The upstream collection also contains image-generation, image-to-code, Stitch, legacy v1, and fixed aesthetic preset skills. Those are intentionally not vendored here because they would introduce unrelated assets, dependencies, or visual mandates. The vendored files are source material for agents, and this repository's governing instructions override them.
