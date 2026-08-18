import type { Actor } from "@/lib/domain";
import { DomainError } from "@/lib/domain";
import { getStore, type MemoryStore } from "@/lib/store";
import { SupabaseWorkspace } from "@/lib/data/supabase-workspace";

export type Workspace = MemoryStore | SupabaseWorkspace;

/**
 * Demo actors use MemoryStore.
 * Authenticated production/preview users always use Postgres.
 * There is no silent fallback to memory.
 */
export function getWorkspace(actor: Actor): Workspace {
  if (actor.source === "demo") return getStore();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new DomainError("Database access failed. Production workspaces require Supabase.");
  }
  return new SupabaseWorkspace();
}
