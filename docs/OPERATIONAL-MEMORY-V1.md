# Operational Memory Contract v1

Status: **CS-11 contract boundary**

## Purpose

CS-11 makes memory a governed Delegation Cloud artifact rather than ambient model context. It distinguishes working, operational, entity, procedural, preference, and historical memory while keeping the authority for promotion, invalidation, and expiry outside the executor.

## Contract

`src/lib/operational-memory.ts` defines:

- a typed memory kind and lifecycle status;
- an organization-bound scope;
- provenance with source artifacts, run/assignment references, observation time, recorder, and approver;
- review and expiry dates;
- a content hash over the complete memory body;
- promotion, conflict, invalidation, and expiry operations.

Every memory is an immutable candidate artifact first. An executor may propose it, but a candidate has no approver and is not verified. `promoteOperationalMemory` requires an accountable approver and preserves the original provenance.

## Invariants

- A verified memory always has an approver.
- Candidate memory cannot carry approval.
- Conflicting facts are returned as separate artifacts in one conflict set. Neither value is overwritten or silently selected.
- Conflicts are allowed only for the same memory kind, subject, and exact organization scope.
- Invalidated memory records when and why it was invalidated.
- Expired memory can only be marked expired after its declared deadline.
- Review dates cannot be later than expiry dates.
- Source artifact IDs are unique and every memory has at least one source artifact.
- The content hash detects post-freeze mutation.

Scope is explicit so customer-specific knowledge cannot silently become global knowledge. A future promotion service can require additional policy for global or procedural memory, but this contract does not grant that authority.

## Non-goals

This slice does not add a vector database, retrieval ranking, automatic promotion, cross-tenant sharing, entity resolution, or a memory write path. It does not let an executor turn its own context into organization policy.

The next integration should store these artifacts through the existing evidence/provenance plane and make every promotion or invalidation reviewable.
