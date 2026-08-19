/**
 * Read-only Production env mapping check. Never writes Vercel or Supabase.
 */
const previewRef = "qbvmtgaphvpwpwemplje";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
];
const email = ["TRANSACTIONAL_EMAIL_FROM", "RESEND_API_KEY"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const report = {
  writes: false,
  previewProjectMustNotBeProduction: previewRef,
  urlLooksLikePreview: url.includes(previewRef),
  present: Object.fromEntries(required.map((k) => [k, Boolean(process.env[k])])),
  emailPresent: Object.fromEntries(email.map((k) => [k, Boolean(process.env[k])])),
  blocker:
    !url || url.includes(previewRef)
      ? "Production must use a new Supabase project. Do not point Production at qbvmtgaphvpwpwemplje."
      : null,
};

console.log(JSON.stringify(report, null, 2));
if (report.blocker) process.exit(2);
