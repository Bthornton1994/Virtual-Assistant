# Engineering Workspace Isolation v1

CS-6 gives each coding candidate an explicit isolated workspace. It internalizes the useful isolation principle from Orca without adopting Orca as a scheduler or source of authority.

## Workspace contract

Each record carries:

- repository and a frozen base Git SHA;
- candidate and experiment identifiers;
- branch plus branch, worktree, or container reference;
- executor identity and configuration snapshot;
- result Git SHA;
- verification evidence references;
- cleanup lifecycle state.

A workspace record never grants merge authority. A result can be compared only after it is verified, and comparison requires the same repository, frozen base SHA, experiment, and distinct mutable workspace references.

## Lifecycle

The contract supports:

1. provisioning;
2. activation;
3. result submission;
4. independent verification;
5. cleanup request and completion;
6. abandonment for blocked candidates.

Cleanup completion is explicit. A cleaned workspace retains result and verification references for replayable evidence.

## Bounded candidate comparison

Multiple candidates can be compared only when they are independently verified and isolated. The comparison is deterministic and returns candidate evidence metadata; it does not select a winner, merge a branch, or mutate repository state.

The next implementation step is an operator that provisions branches or worktrees from the frozen base SHA and records verification artifacts. This contract deliberately adds no filesystem orchestration, network calls, scheduler, Supabase, or Production writes.
