# Agent Instructions

## Project vision

Read `VISION.md` and `README.md` before planning substantial changes to request intake, workstreams, routing, AI behavior, automation, operator tools, approvals, quality assurance, customer data, security, monetization, architecture, or scope.

For each substantial proposal, classify it as:

- **Aligns**
- **Aligns with constraints**
- **Conflicts**
- **Vision is silent**

Name the relevant `VISION.md` section in the plan or handoff. If a request conflicts with the vision or requires an owner decision the vision does not resolve, surface the conflict and ask whether the request or the vision should change. Do not silently rewrite the vision to make a feature fit.

Treat explicit authority, required approvals, least-privilege access, organization isolation, auditability, human accountability, and manual proof before automation as hard boundaries. Never let an agent send, purchase, publish, commit, transfer funds, alter access, or take another external or sensitive action without the defined authorization.

Only edit `VISION.md` when the task explicitly authorizes a governing decision change. Small fixes need no formal vision analysis, but they must preserve these boundaries. Report validation and any remaining vision tension before handoff.
