# Context Provider Bakeoff v1

CS-5 defines a provider-neutral experiment boundary for repository context. It harvests useful ideas from Graft and Codebase Memory without making either one Delegation Cloud architecture.

## Contract

The ContextProvider interface exposes the eight roadmap operations:

- build
- refresh
- architecture
- findSymbol
- findCallers
- impactAnalysis
- search
- health

Requests carry an exact repository snapshot hash. Responses carry the same snapshot hash, a source-artifact hash, stale-context state, privacy handling, and derived paths/symbols. A provider can build or refresh a derived cache, but it cannot edit repository source or become the source of policy.

## Benchmark design

The harness requires at least one task with unseen set to true, an exact repository snapshot hash, expected files/symbols, and an allowed operation set. Each observation must reference the exact task version and snapshot. Invalid or mismatched artifacts are rejected, never repaired.

Conditions are intentionally comparable:

1. cold_agent
2. graft
3. codebase_memory
4. native_future

Rows are keyed by condition, provider, and operation so a provider cannot hide a weak operation behind a portfolio-wide average.

## Measures

The scorecard records:

- correct answer or change;
- affected-file recall;
- false structural conclusions;
- token and tool-call counts;
- wall-time median and p95;
- setup and maintenance minutes;
- stale-context incidents;
- privacy incidents and approved, redacted, or blocked handling.

The scorecard is descriptive evidence only. It does not select a provider, route work, qualify an executor, or mutate Loadout.

## Decision gate

After identical unseen tasks run on Delegation Cloud and Loadout, choose one of:

- adapter;
- hybrid;
- native subset;
- reject.

Do not deploy multiple context systems portfolio-wide before this evidence exists. The next implementation step is to add adapters behind this contract and run the same task set; this PR intentionally adds no provider integration, network calls, or production writes.
