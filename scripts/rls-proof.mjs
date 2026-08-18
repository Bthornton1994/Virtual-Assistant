/**
 * Live RLS proof: org A cannot read/write org B.
 * Requires two provisioned client users and the dedicated DC project.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const aEmail = process.env.E2E_CLIENT_EMAIL;
const aPass = process.env.E2E_CLIENT_PASSWORD;
const bEmail = process.env.E2E_OTHER_CLIENT_EMAIL;
const bPass = process.env.E2E_OTHER_CLIENT_PASSWORD;

if (!url || !anon || !aEmail || !aPass || !bEmail || !bPass) {
  console.error("BLOCKED: Need NEXT_PUBLIC_SUPABASE_* plus E2E_CLIENT_* and E2E_OTHER_CLIENT_*.");
  process.exit(2);
}

async function session(email, password) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error(`login failed for ${email}`);
  return client;
}

const a = await session(aEmail, aPass);
const b = await session(bEmail, bPass);

const { data: aOrgs, error: aOrgErr } = await a.from("organizations").select("id, name, slug");
const { data: bOrgs, error: bOrgErr } = await b.from("organizations").select("id, name, slug");
if (aOrgErr) throw aOrgErr;
if (bOrgErr) throw bOrgErr;
if (!aOrgs?.length || !bOrgs?.length) throw new Error("Each user must belong to an organization");

const aOrg = aOrgs[0].id;
const bOrg = bOrgs[0].id;
if (aOrg === bOrg) throw new Error("Both users resolved to the same organization");

const { data: planted, error: plantErr } = await a
  .from("requests")
  .insert({
    organization_id: aOrg,
    title: "RLS plant A",
    objective: "Prove isolation",
    description: "Confidential to org A",
    deliverable: "None",
    status: "queued",
    priority: "medium",
    risk_level: "low",
    approval_level: "prepare_only",
  })
  .select("id")
  .single();
if (plantErr) throw plantErr;

const { data: leaked } = await b.from("requests").select("id, title").eq("id", planted.id);
const { data: crossInsert, error: crossErr } = await b.from("requests").insert({
  organization_id: aOrg,
  title: "Cross tenant write",
  objective: "Should fail",
  description: "x",
  deliverable: "x",
  status: "queued",
  priority: "medium",
  risk_level: "low",
  approval_level: "prepare_only",
});
const { error: crossUpdate } = await b.from("requests").update({ title: "Hijacked" }).eq("id", planted.id);
const { error: crossDelete } = await b.from("requests").delete().eq("id", planted.id);

const result = {
  orgA: aOrgs[0],
  orgB: bOrgs[0],
  bSawARequest: Boolean(leaked?.length),
  bInsertIntoA: Boolean(crossInsert && !crossErr),
  bUpdatedA: !crossUpdate,
  bDeletedA: !crossDelete,
};

if (result.bSawARequest || result.bInsertIntoA || result.bUpdatedA || result.bDeletedA) {
  console.error("FAIL", result);
  process.exit(1);
}

console.log("PASS", result);
