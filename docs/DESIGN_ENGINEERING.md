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