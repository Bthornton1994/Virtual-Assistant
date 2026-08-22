"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { recoverAutonomyProfile } from "@/lib/gauntlet-recovery";

function rethrowAction(error: unknown): never {
  if (error instanceof DomainError || error instanceof AuthzError) throw new Error(error.message);
  throw error;
}

export async function recoverAutonomyProfileAction(formData: FormData) {
  const actor = await requireOps();
  try {
    await recoverAutonomyProfile(
      actor,
      String(formData.get("profileId") || ""),
      String(formData.get("reason") || ""),
    );
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/ops/gauntlet");
}
