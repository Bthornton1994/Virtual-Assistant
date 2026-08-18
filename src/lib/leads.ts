import { uid, nowIso } from "@/lib/domain";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type LeadRecord = {
  id: string;
  name: string;
  email: string;
  company: string;
  outcome: string;
  source: string;
  utm: Record<string, string>;
  createdAt: string;
};

const memoryLeads: LeadRecord[] = [];

export async function persistLead(input: {
  name: string;
  email: string;
  company: string;
  outcome?: string;
  source?: string;
  utm?: Record<string, string>;
}) {
  const lead: LeadRecord = {
    id: uid("ld"),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    company: input.company.trim(),
    outcome: (input.outcome || "").trim(),
    source: input.source || "book",
    utm: input.utm ?? {},
    createdAt: nowIso(),
  };
  const admin = supabaseAdmin();
  if (admin) {
    const { error } = await admin.from("leads").insert({
      id: lead.id,
      name: lead.name,
      email: lead.email,
      company: lead.company,
      outcome: lead.outcome,
      source: lead.source,
      utm: lead.utm,
      status: "new",
    });
    if (error) throw new Error("We could not save that request. Try again or email us directly.");
    return { ...lead, persisted: "postgres" as const };
  }
  memoryLeads.unshift(lead);
  return { ...lead, persisted: "ephemeral" as const };
}

export function listMemoryLeads() {
  return [...memoryLeads];
}
