import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import {
  validateExecutionContext,
  type ExecutionContext,
} from "@/lib/execution-context";
import {
  validateMemoryContext,
  type MemoryContext,
} from "@/lib/memory-control-plane";

export const MEMORY_EXECUTION_BINDING_SCHEMA_VERSION =
  "memory-execution-binding/v1" as const;

const selectedMemoryRefSchema = z
  .object({
    memoryId: identifierString,
    revision: z.number().int().min(1),
    memoryHash: sha256HexSchema,
  })
  .strict();

const memoryExecutionBindingBodySchema = z
  .object({
    schemaVersion: z.literal(MEMORY_EXECUTION_BINDING_SCHEMA_VERSION),
    executionContextHash: sha256HexSchema,
    memoryContextHash: sha256HexSchema,
    memoryReadReceiptHash: sha256HexSchema,
    runId: identifierString,
    assignmentId: identifierString,
    selectedMemoryIds: z.array(identifierString).max(100),
    selectedMemoryRefs: z.array(selectedMemoryRefSchema).max(100),
  })
  .strict()
  .superRefine((binding, context) => {
    const refIds = binding.selectedMemoryRefs.map((ref) => ref.memoryId);
    if (new Set(refIds).size !== refIds.length) {
      context.addIssue({
        code: "custom",
        path: ["selectedMemoryRefs"],
        message: "selectedMemoryRefs must not contain duplicate memory IDs.",
      });
    }
    if (JSON.stringify(binding.selectedMemoryIds) !== JSON.stringify(refIds)) {
      context.addIssue({
        code: "custom",
        path: ["selectedMemoryIds"],
        message: "selectedMemoryIds must exactly match selectedMemoryRefs.",
      });
    }
  });

export const memoryExecutionBindingSchema = memoryExecutionBindingBodySchema
  .extend({
    bindingHash: sha256HexSchema,
  })
  .strict();

export type MemoryExecutionBinding = z.infer<
  typeof memoryExecutionBindingSchema
>;

export type MemoryExecutionBindingResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(
  issues: readonly z.ZodIssue[],
  prefix: string,
): string[] {
  return issues.map(
    (issue) => prefix + issue.path.join(".") + ": " + issue.message,
  );
}

function bodyWithoutHash(
  binding: MemoryExecutionBinding,
): Omit<MemoryExecutionBinding, "bindingHash"> {
  const { bindingHash: _bindingHash, ...body } = binding;
  return body;
}

export function hashMemoryExecutionBinding(
  binding: MemoryExecutionBinding,
): string {
  return sha256Hex(bodyWithoutHash(binding));
}

export function validateMemoryExecutionBinding(
  input: unknown,
): MemoryExecutionBindingResult<MemoryExecutionBinding> {
  const parsed = memoryExecutionBindingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      failures: issueMessages(parsed.error.issues, "Binding "),
    };
  }
  if (hashMemoryExecutionBinding(parsed.data) !== parsed.data.bindingHash) {
    return {
      ok: false,
      failures: ["Binding bindingHash does not match the canonical body."],
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Binds a production memory context to one immutable execution context.
 * Shadow retrieval and advisory candidates are deliberately ineligible for
 * execution binding; they belong in measurement artifacts instead.
 */
export function bindMemoryContextToExecution(
  executionContextInput: unknown,
  memoryContextInput: unknown,
): MemoryExecutionBindingResult<MemoryExecutionBinding> {
  const execution = validateExecutionContext(executionContextInput);
  const memory = validateMemoryContext(memoryContextInput);
  const failures: string[] = [];

  if (!execution.ok) failures.push(...execution.failures.map((failure) => "Execution " + failure));
  if (!memory.ok) failures.push(...memory.failures.map((failure) => "Memory " + failure));
  if (!execution.ok || !memory.ok) return { ok: false, failures };

  const context: ExecutionContext = execution.value;
  const compiled: MemoryContext = memory.value;
  if (compiled.request.mode !== "production") {
    failures.push("Only production memory contexts can be bound for execution.");
  }
  if (compiled.items.some((item) => item.advisory)) {
    failures.push("Advisory memory cannot be bound for execution.");
  }
  if (compiled.request.runId !== context.runId) {
    failures.push("Memory request runId does not match the execution context.");
  }
  if (compiled.request.assignmentId !== context.assignmentId) {
    failures.push("Memory request assignmentId does not match the execution context.");
  }
  if (compiled.readReceipt.runId !== context.runId) {
    failures.push("Memory receipt runId does not match the execution context.");
  }
  if (compiled.readReceipt.assignmentId !== context.assignmentId) {
    failures.push("Memory receipt assignmentId does not match the execution context.");
  }
  if (failures.length > 0) return { ok: false, failures };

  const selectedMemoryRefs = compiled.items.map((item) => ({
    memoryId: item.memory.memoryId,
    revision: item.memory.revision,
    memoryHash: item.memory.memoryHash,
  }));
  const body = {
    schemaVersion: MEMORY_EXECUTION_BINDING_SCHEMA_VERSION,
    executionContextHash: context.contextHash,
    memoryContextHash: compiled.contextHash,
    memoryReadReceiptHash: compiled.readReceipt.receiptHash,
    runId: context.runId,
    assignmentId: context.assignmentId,
    selectedMemoryIds: selectedMemoryRefs.map((ref) => ref.memoryId),
    selectedMemoryRefs,
  };
  const binding = {
    ...body,
    bindingHash: sha256Hex(body),
  };
  return validateMemoryExecutionBinding(binding);
}
