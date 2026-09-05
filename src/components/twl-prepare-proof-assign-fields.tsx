"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import type { Operator } from "@/lib/domain";

export function TwlPrepareProofAssignFields({ operators }: { operators: Operator[] }) {
  const [workerKind, setWorkerKind] = useState<"shadow" | "human_operator">("shadow");
  const [workerKey, setWorkerKey] = useState(operators[0]?.id ?? "");
  const selected = operators.find((operator) => operator.id === workerKey);

  return (
    <>
      <Field label="Worker">
        <select
          name="workerKind"
          value={workerKind}
          onChange={(event) => setWorkerKind(event.target.value === "human_operator" ? "human_operator" : "shadow")}
          className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="shadow">Shadow worker (cannot Accept)</option>
          <option value="human_operator">Human operator (cannot Accept alone)</option>
        </select>
      </Field>
      {workerKind === "human_operator" ? (
        <Field label="Human operator">
          <select
            name="workerKey"
            value={workerKey}
            onChange={(event) => setWorkerKey(event.target.value)}
            className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Select operator</option>
            {operators.map((operator) => (
              <option key={operator.id} value={operator.id}>
                {operator.name} · {operator.platformRole.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="workerKey" value="" />
      )}
      <input type="hidden" name="displayName" value={selected?.name ?? ""} />
    </>
  );
}
