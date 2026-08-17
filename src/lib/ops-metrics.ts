import type { RequestRecord } from "@/lib/domain";
import { deliveredStatuses } from "@/lib/domain";

export function countOverdue(requests: RequestRecord[], nowMs: number) {
  const closed = new Set([...deliveredStatuses(), "cancelled"]);
  return requests.filter((r) => r.dueAt && new Date(r.dueAt).getTime() < nowMs && !closed.has(r.status)).length;
}

export function currentTimeMs() {
  return Date.now();
}
