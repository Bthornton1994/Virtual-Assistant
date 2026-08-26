# Execution Context v1

Status: **CS-10 contract boundary**

## Purpose

CS-10 makes runtime tool access explicit. A Delegation Spec declares the action class and the tool classes it permits. An assignment contributes the run, capability, executor, input/output contracts, executor configuration snapshot, and deadline. `createExecutionContext` freezes both into a hash-bound context for one assignment.

The context is advisory until every runtime adapter enforces it centrally. That is still useful: a runtime can record the exact envelope it received, and verification can reject traces that do not validate against it.

## Tool classes

The initial vocabulary is deliberately small:

- read-only public and artifact access;
- artifact writing and deterministic validation;
- repository reading and prepare-only changes;
- external message drafting;
- external messaging, sensitive actions, and credential use.

Tool classes are not provider names, model names, or ambient SDK capabilities. A runtime must invoke a named class and tool key. The action class places a ceiling on which classes may be authorized. For example, `prepare_only` can include public reads and drafts but cannot include `external_message_send`, `sensitive_action`, or `credential_use`.

## Context and credentials

The context stores:

- the frozen Delegation Spec snapshot;
- the frozen assignment snapshot;
- the exact authorized tool-class list;
- opaque credential references and scopes;
- a prompt artifact reference, if one exists;
- `secretMaterialIncluded: false`.

Credentials are references only. Secret material never belongs in a prompt or executor-authored artifact. A credential reference identifies a separately scoped secret that an adapter may resolve under its own boundary; it does not grant authority by itself.

## Detection and verification

`validateToolInvocation` binds each invocation to the context hash and rejects:

- a stale or tampered context;
- a context hash mismatch;
- a tool class not authorized by the snapshot;
- an invocation that claims `blocked` without the canonical `tool_class_not_authorized` failure code.

`validateToolInvocationTrace` applies the same gate to a full trace. An outside-envelope attempt is evidence of a boundary violation and must block verification; it is not repaired into an allowed invocation.

No function in this slice routes work, chooses a provider, resolves credentials, sends a message, changes a repository, or owns lifecycle state.
