# Model Provider Abstraction v1

Status: **CS-9 contract boundary**

## Purpose

CS-9 makes model execution capacity replaceable without making a provider, gateway, or model part of a Delegation Cloud workstream. A workstream asks for a capability such as `evidence_research`; it does not ask for OpenRouter, Grok, Hermes, or a particular runtime as its durable contract.

This slice is intentionally contract-only. It does not add credentials, provider routing, network calls, or a production adapter.

## Contract

`src/lib/model-provider.ts` defines:

- `ModelConfiguration`: provider, provider version, model, protocol version, data policy, output limit, and a configuration hash;
- `InferenceRequest`: a capability request with input artifact references, an exact data policy, and a declarative fallback policy;
- `InferenceResult`: immutable provider/model provenance plus output artifact, usage, cost, latency, status, and failure code;
- `ModelProviderHealth`: deterministic health vocabulary with an explanation for every non-healthy state;
- `ModelProvider`: the small adapter interface: `infer` and `health`;
- `validateInferenceResult`: a boundary check that binds a result to the exact request that produced it.

The result records both `providerKey` and `providerVersion`, alongside `configurationKey`, `protocolVersion`, `modelId`, and `configHash`. A provider or model change therefore creates a different attributable execution record instead of silently changing the meaning of a historical result.

## Invariants

- Model configuration and request data policy must match exactly. A public request cannot be silently sent through a configuration approved only for a different policy.
- Completed inference has an output artifact and completion time, and cannot carry a failure code.
- Failed or blocked inference has a failure code and no output artifact.
- Token totals and cost totals are recomputed by schema invariants, not trusted from prose.
- Cost is integer micro-USD, with AI and tool components preserved separately.
- Latency is non-negative and records both queue and end-to-end time.
- A result's provider, version, configuration, protocol, model, hash, and policy must match its request.
- Non-healthy provider states must carry a message explaining the condition.
- Fallback is declarative only in this slice. This contract does not route, retry, promote, or select a provider.

## Data and authority boundaries

Artifact references are hashes and IDs, not mutable model context. Providers may produce observations and candidate artifacts, but they do not own lifecycle state, costs, verification gates, qualification, or routing decisions. The deterministic validator and accountable humans remain authoritative.

The data policy is part of the request and result so an adapter cannot hide a transfer to a provider with a weaker boundary. The next slice can add an adapter only after it can preserve these fields and the repository's existing executor envelope.

## Exit evidence

CS-9 is complete when an implementation can:

1. accept a capability request without changing the workstream contract;
2. return a result that is attributable to a provider/model configuration;
3. report usage, cost, and latency in deterministic shapes;
4. expose health without treating health as qualification;
5. be replaced by another implementation using the same interface.

This PR proves the boundary and its rejection cases. It deliberately does not claim that any provider is reliable, cheap, qualified, or authorized for a given tenant.
