# UI design engineering

Virtual Assistant uses a focused, vendored subset of Emil Kowalski's UI skills to make Delegation Cloud feel clear, calm, and operationally trustworthy.

## Source

- Upstream: https://github.com/emilkowalski/skills
- Pinned source commit: `d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7`
- License: MIT, see `docs/EMIL-SKILLS-LICENSE.md`.
- Vendored skills are updated deliberately from the pinned source commit so agent behavior remains reproducible.

## How agents use the skills

- Read this file and `VISION.md` before UI work.
- Read `.claude/skills/emil-design-eng/SKILL.md` when the change involves interaction, motion, or component craft.
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
- Local modifications to `design-taste-frontend` (against `ccbc15639c97057cbfcf32ecebc38ef716e4bb37`), to carry forward on any upstream update:
  - Removed every instruction that required remembering a previously generated project, because the agent has no such record: the palette-rotation rule in section 4.2 and its pre-flight question, the rule against reusing a serif across consecutive projects in section 4.1, the "rotate, do not reuse" wording on the default palette alternatives, and the pre-flight question about the previous project's serif. The font pool and palette alternatives remain as options to choose from by fit. The override rule against defaulting to beige and brass, and the pre-flight checks against that default and against Fraunces and Instrument Serif, are unchanged.
  - The image-generation step in section 4.8 now applies when the brief needs new imagery, the surface is in scope for generated imagery under this repository's instructions, and a tool is available. It is no longer an unconditional requirement whenever any tool exists. Step 2 now applies when generated imagery is unavailable or out of scope.

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

## ibelick UI Skills

- Upstream: https://github.com/ibelick/ui-skills
- Pinned source commit: `f2dadf221a166a79606b337d08ce0b04d0d2bfd9`
- License: MIT, see `docs/IBELICK-UI-SKILLS-LICENSE.md`.
- Vendored files: `ui-skills-root`, `baseline-ui`, `improve-ui`, `fixing-accessibility`, and `fixing-motion-performance`.
- `create-design-md` is intentionally not vendored because this repository already has governing design documentation.

### Application

- Route UI work through the smallest relevant skill. Use the baseline rules for text wrapping, tabular numbers, touch targets, existing tokens, and bounded interaction polish.
- Use the accessibility rules for accessible names, keyboard access, focus and dialogs, forms and errors, announcements, contrast, and reduced motion.
- Use the motion-performance rules for compositor-first motion, batched measurement, IntersectionObserver or CSS timelines for visibility and scroll behavior, and scoped blur or filters.
- Use the existing product stack and primitives. Do not add a UI library, migrate animation libraries, add a CLI or runtime dependency, or create a parallel design system solely because the upstream collection mentions one.
- Use `improve-ui` as an evidence gate for coherent surfaces. It is read-only on product source and plans bounded work; implementation remains governed by this repository's instructions and the owner-approved task.

- Scope: product interfaces, shared UI primitives, and responsive navigation. On marketing routes the baseline rules apply where they do not conflict with the marketing visual direction; see Precedence.
- Preserve: outcome, access, approval, logging, verification, tenant-isolation, and Delegation Spec language.
- Exclude: operational authority changes, autonomous execution claims, customer-data behavior, and dashboard rewrites.


## Precedence

Project-specific instructions come first: `AGENTS.md`, `VISION.md`, `DESIGN.md`, this file, and the governing Delegation Spec. They override every vendored skill.

Below them, two vendored skills split the interface by surface. Neither outranks the other.

- `design-taste-frontend` guides visual direction on marketing pages.
- `baseline-ui` guides implementation and quality on product interfaces, including the operational app and shared UI primitives.

A direct conflict follows the scope of the surface being changed. A shared primitive keeps the `baseline-ui` rules, because it also renders on product interfaces; a marketing page that needs a different treatment styles its own instance, not the shared primitive. For example, on a marketing page `design-taste-frontend` governs gradients, headline letter-spacing, and whether to add motion. On a product interface the `baseline-ui` rules on those points govern. Rules that do not conflict apply on both kinds of surface.

## External UI and copy quality gates

- Use the existing design system and the smallest relevant skill from `docs/EXTERNAL-AGENT-SKILLS.md`; do not introduce a parallel visual system.
- Use `no-ai-design-slop` as a removal-first review. Preserve product-specific identity, useful density, honest placeholders, and explicit states.
- Use `no-ai-slop` for visible copy. Preserve supported claims and approved disclaimers; do not add invented proof or inflated outcomes.
- Use `frontend-ui-engineering` for keyboard access, responsive behavior, loading, empty, error, and focus states.
- Use `source-driven-development` for framework-specific changes and `verification-before-completion` before completion claims.
- Scope: marketing routes and shared UI primitives. Product behavior, data handling, scoring, benefits, commerce, authority, and release gates remain outside this design layer.
