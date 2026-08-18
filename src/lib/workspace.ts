import type { Actor } from "@/lib/domain";
import { DomainError } from "@/lib/domain";
import { getStore, type MemoryStore } from "@/lib/store";

/**
 * Production workspaces persist in Postgres.
 * MemoryStore is legal only for isolated demo actors and unit tests.
 */
export function getWorkspace(actor: Actor): MemoryStore {
  if (actor.source === "demo") {
    return getStore();
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new DomainError("Production workspaces require a persistent database.");
  }
  // Postgres-backed repository is the only legal production store.
  // Until the org is provisioned in Supabase, fail closed instead of simulating state.
  throw new DomainError(
    "This account is not provisioned on the persistent workspace yet. Ask operations to send an invitation.",
  );
}
