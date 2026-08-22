import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, DomainError, assertOrgAccess, type Actor } from "@/lib/domain";
import { supabaseServer } from "@/lib/supabase/server";

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") throw new DomainError("Autonomy recovery requires the persistent Supabase workspace.");
  const db = await supabaseServer();
  if (!db) throw new DomainError("Autonomy recovery requires Supabase.");
  return db;
}

function managerOnly(actor: Actor) {
  if (actor.role !== "ops_manager" && actor.role !== "platform_admin") {
    throw new AuthzError("Only operations managers can recover suspended autonomy profiles.");
  }
}

export async function recoverAutonomyProfile(actor: Actor, profileId: string, reason: string) {
  managerOnly(actor);
  const recoveryReason = reason.trim();
  if (!profileId) throw new DomainError("Autonomy profile is required.");
  if (!recoveryReason) throw new DomainError("Autonomy recovery requires an explicit reason.");

  const db = await persistentDb(actor);
  const { data: profile, error: profileError } = await db
    .from("workstream_autonomy_profiles")
    .select("id, organization_id, workstream_id, current_level, state")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError) throw new DomainError(profileError.message);
  if (!profile) throw new DomainError("Autonomy profile not found.");
  assertOrgAccess(actor, profile.organization_id);
  if (profile.state !== "suspended") throw new DomainError("Only a suspended autonomy profile can be recovered.");

  const { data: recovery, error: recoveryError } = await db
    .from("autonomy_recoveries")
    .insert({
      organization_id: profile.organization_id,
      workstream_id: profile.workstream_id,
      from_level: profile.current_level,
      to_level: 0,
      reason: recoveryReason,
      recovered_by: actor.id,
    })
    .select("id, organization_id, workstream_id, from_level, to_level, reason, recovered_by, created_at")
    .single();
  if (recoveryError) throw new DomainError(recoveryError.message);

  const { data: recoveredProfile, error: verificationError } = await db
    .from("workstream_autonomy_profiles")
    .select("id, current_level, state, updated_at")
    .eq("id", profileId)
    .single();
  if (verificationError) throw new DomainError(verificationError.message);
  if (Number(recoveredProfile.current_level) !== 0 || recoveredProfile.state !== "active") {
    throw new DomainError("Autonomy recovery did not restore the profile to active Level 0.");
  }

  return { recovery, profile: recoveredProfile };
}
