import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { hashToolInvocationTrace, type ToolInvocationTrace } from "@/lib/tool-invocation-trace";

/**
 * Shared fixtures for TypeScript canonical JSON.
 *
 * These exist so a future live Postgres can compare Node
 * `canonicalJsonStringify` + `sha256Hex` to a SQL port.
 * This branch does **not** ship a SQL hash helper: parity was not
 * proven (no live Postgres; `jsonb::text` is not JS canonical JSON).
 */
export const CANONICAL_JSON_PARITY_FIXTURES: ReadonlyArray<{
  name: string;
  value: unknown;
}> = [
  {
    name: "key order is sorted",
    value: { z: "last", a: "first", m: "middle" },
  },
  {
    name: "nested objects sort at every level",
    value: { outer: { b: 1, a: { d: false, c: true } }, first: "ok" },
  },
  {
    name: "arrays preserve order and canonicalize items",
    value: { items: [{ b: "2", a: "1" }, { d: "4", c: "3" }] },
  },
  {
    name: "booleans and null",
    value: { yes: true, no: false, empty: null },
  },
  {
    name: "strings including quotes and slashes",
    value: { text: 'say "hello" \\ path/to' },
  },
  {
    name: "timestamps stay strings",
    value: { invokedAt: "2026-09-09T16:00:00Z", completedAt: "2026-09-09T16:00:01.250Z" },
  },
  {
    name: "empty arrays",
    value: { invocations: [], outcomes: [] },
  },
  {
    name: "nested invocation object",
    value: {
      schemaVersion: "tool-invocation-trace/v1",
      productionClass: "native_tool_execution",
      assignmentId: "a".repeat(64),
      envelopeHash: "b".repeat(64),
      contextHash: "c".repeat(64),
      dcExecutedTools: true,
      externalAgentToolUse: "not_applicable",
      invocations: [
        {
          schemaVersion: "execution-context/v1",
          invocationId: "invocation-001",
          contextHash: "c".repeat(64),
          toolClass: "public_read",
          toolKey: "public-https-fetch",
          status: "allowed",
          invokedAt: "2026-09-09T16:00:00Z",
          completedAt: "2026-09-09T16:00:01Z",
          failureCode: null,
        },
      ],
      outcomes: [{ invocationId: "invocation-001", result: "fetched" }],
    },
  },
];

export const EMPTY_OPERATOR_TRACE: ToolInvocationTrace = {
  schemaVersion: "tool-invocation-trace/v1",
  productionClass: "operator_submitted",
  assignmentId: "d".repeat(64),
  envelopeHash: "e".repeat(64),
  contextHash: "f".repeat(64),
  dcExecutedTools: false,
  externalAgentToolUse: "unknown",
  invocations: [],
  outcomes: [],
};

export function fixtureCanonicalStrings(): Array<{ name: string; canonical: string; sha256: string }> {
  return CANONICAL_JSON_PARITY_FIXTURES.map((fixture) => ({
    name: fixture.name,
    canonical: canonicalJsonStringify(fixture.value),
    sha256: sha256Hex(fixture.value),
  }));
}

export function emptyOperatorTraceHash(): string {
  return hashToolInvocationTrace(EMPTY_OPERATOR_TRACE);
}
