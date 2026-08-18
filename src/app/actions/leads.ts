"use server";

import { redirect } from "next/navigation";
import { persistLead } from "@/lib/leads";

export async function bookCallAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const company = String(formData.get("company") || "").trim();
  const outcome = String(formData.get("outcome") || "").trim();
  if (!name || !email || !company) redirect("/book?error=missing");
  try {
    await persistLead({
      name,
      email,
      company,
      outcome,
      source: "book",
      utm: {
        utm_source: String(formData.get("utm_source") || ""),
        utm_medium: String(formData.get("utm_medium") || ""),
        utm_campaign: String(formData.get("utm_campaign") || ""),
        ref: String(formData.get("ref") || ""),
      },
    });
  } catch {
    redirect("/book?error=save");
  }
  redirect("/book/thanks");
}
