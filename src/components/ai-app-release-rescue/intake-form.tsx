"use client";

import { useActionState, useId } from "react";
import { submitRescueIntakeAction } from "@/app/actions/ai-app-release-rescue";
import { NonClaimsCallout } from "@/components/ai-app-release-rescue/non-claims";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  ACCESS_GRANT_METHOD_COPY,
  ACCESS_GRANT_METHODS,
  APP_TYPE_COPY,
  APP_TYPES,
} from "@/lib/ai-app-release-rescue/constants";
import {
  ACCESS_WINDOW_DAY_OPTIONS,
  ATTESTATION_COPY,
  ATTESTATION_FIELDS,
  REPOSITORY_HOSTS,
  REPOSITORY_HOST_COPY,
  RETENTION_POLICY_COPY,
  SCOPE_FACT_COPY,
  SCOPE_FACT_FIELDS,
  initialRescueIntakeState,
} from "@/lib/ai-app-release-rescue/intake";

const selectClassName =
  "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink outline-none ring-accent/30 transition-[border-color,box-shadow] duration-150 ease-[var(--ease-ui-out)] focus:border-accent focus:ring-2 sm:text-sm";

export function RescueIntakeForm() {
  const [state, action, pending] = useActionState(submitRescueIntakeAction, initialRescueIntakeState);
  const errorSummaryId = useId();
  const errors = state?.errors ?? {};
  const formError = state?.formError ?? null;
  const values = state?.values ?? {};

  return (
    <form action={action} className="space-y-10" key={formError ? JSON.stringify(values) : "fresh"}>
      {formError || Object.keys(errors).length > 0 ? (
        <div
          id={errorSummaryId}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad"
        >
          {formError ?? "Check the highlighted fields. Nothing was stored."}
        </div>
      ) : null}

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Contact</h2>
        <p className="text-sm text-ink-soft">
          Name and work email only. Demo submissions stay in this server’s memory. They are not written to the customer
          database and are not a billing record.
        </p>
        <Field label="Name" error={errors.contactName}>
          <Input name="contactName" autoComplete="name" required defaultValue={values.contactName} />
        </Field>
        <Field label="Work email" error={errors.workEmail}>
          <Input name="workEmail" type="email" autoComplete="email" required defaultValue={values.workEmail} />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Scope</h2>
        <p className="text-sm text-ink-soft">One repository. One web application. One critical workflow.</p>
        <Field
          label="Repository URL"
          hint="Public https URL. No tokens in the URL. No second repository."
          error={errors.repositoryUrl}
        >
          <Input
            name="repositoryUrl"
            type="url"
            inputMode="url"
            placeholder="https://github.com/org/app"
            required
            defaultValue={values.repositoryUrl}
          />
        </Field>
        <Field label="Web application type" error={errors.appType}>
          <select name="appType" required className={selectClassName} defaultValue={values.appType ?? ""}>
            <option value="" disabled>
              Choose one
            </option>
            {APP_TYPES.map((type) => (
              <option key={type} value={type}>
                {APP_TYPE_COPY[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Critical workflow"
          hint="The path you care about most, from start to a done state."
          error={errors.criticalWorkflow}
        >
          <Textarea
            name="criticalWorkflow"
            required
            placeholder="Staff sign-in through creating an inventory receipt"
            defaultValue={values.criticalWorkflow}
          />
        </Field>
        <Field label="Application name" error={errors.applicationName}>
          <Input name="applicationName" required placeholder="Harbor Ledger" defaultValue={values.applicationName} />
        </Field>
        <Field label="Where the repository is hosted" error={errors.repositoryHost}>
          <select
            name="repositoryHost"
            required
            className={selectClassName}
            defaultValue={values.repositoryHost ?? "github"}
          >
            {REPOSITORY_HOSTS.map((host) => (
              <option key={host} value={host}>
                {REPOSITORY_HOST_COPY[host]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default branch" hint="We review the tip of this branch." error={errors.defaultBranch}>
          <Input name="defaultBranch" placeholder="main" defaultValue={values.defaultBranch ?? "main"} />
        </Field>
        <Field
          label="Where that workflow starts"
          hint="A route, a screen, or an entry point. Example: /expenses/new"
          error={errors.criticalWorkflowEntryPoint}
        >
          <Input
            name="criticalWorkflowEntryPoint"
            required
            placeholder="/expenses/new"
            defaultValue={values.criticalWorkflowEntryPoint}
          />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">About this workflow</h2>
        <p className="text-sm text-ink-soft">
          These answers go into the scope your report is bound to, so they need to come from you rather than from
          our assumptions.
        </p>
        <fieldset className="space-y-3">
          <legend className="sr-only">Facts about this application and workflow</legend>
          {SCOPE_FACT_FIELDS.map((field) => (
            <label key={field} className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                name={field}
                className="mt-1 size-4"
                defaultChecked={values[field] === "on"}
              />
              <span>{SCOPE_FACT_COPY[field]}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Access</h2>
        <p className="text-sm text-ink-soft">
          Grant read-only access separately — a collaborator invite or a deploy key. This form has no token field
          and will reject pasted secrets.
        </p>
        <Field label="How you will grant read-only access" error={errors.accessGrantMethod}>
          <select
            name="accessGrantMethod"
            required
            className={selectClassName}
            defaultValue={values.accessGrantMethod ?? ""}
          >
            <option value="" disabled>
              Choose one
            </option>
            {ACCESS_GRANT_METHODS.map((method) => (
              <option key={method} value={method}>
                {ACCESS_GRANT_METHOD_COPY[method]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="How long that access stays open"
          hint="It expires automatically. You can revoke it sooner at any time."
          error={errors.accessWindowDays}
        >
          <select name="accessWindowDays" required className={selectClassName} defaultValue={values.accessWindowDays ?? "14"}>
            {ACCESS_WINDOW_DAY_OPTIONS.map((days) => (
              <option key={days} value={String(days)}>
                {days} days
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="How long we keep your source material after delivery"
          error={errors.retentionPolicy}
        >
          <select
            name="retentionPolicy"
            required
            className={selectClassName}
            defaultValue={values.retentionPolicy ?? "minimum_7_day"}
          >
            {(Object.keys(RETENTION_POLICY_COPY) as Array<keyof typeof RETENTION_POLICY_COPY>).map((policy) => (
              <option key={policy} value={policy}>
                {RETENTION_POLICY_COPY[policy]}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Evidence notes</h2>
        <p className="text-sm text-ink-soft">
          File contents are not uploaded here. You may name repository-relative files. Do not list .env, keys, or
          credential files, and do not paste values.
        </p>
        <Field label="Notes (optional)" error={errors.evidenceNotes}>
          <Textarea
            name="evidenceNotes"
            placeholder="The receipt form is the path we need to ship this week."
            defaultValue={values.evidenceNotes}
          />
        </Field>
        <Field
          label="File names, comma separated (optional)"
          hint="Metadata only. Example: src/app/receipts/new/page.tsx, README.md"
          error={errors.evidenceFileNames}
        >
          <Input
            name="evidenceFileNames"
            placeholder="src/app/receipts/new/page.tsx"
            defaultValue={values.evidenceFileNames}
          />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">AI-assisted review</h2>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="aiAssistedOptIn"
            className="mt-1 size-4"
            defaultChecked={values.aiAssistedOptIn === "on"}
          />
          <span>
            Opt in to AI-assisted review. Snippets may be sent to an AI provider without your name, company, or
            organization. A human still owns the report. Leave unchecked for human-only review.
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="remediationInterest"
            className="mt-1 size-4"
            defaultChecked={values.remediationInterest === "on"}
          />
          <span>After the report, I want to hear about the $1,250 sprint. This is not a purchase.</span>
        </label>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Limitations you must confirm</h2>
        <NonClaimsCallout id="intake-limitations" />
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Confirm each statement</legend>
          {ATTESTATION_FIELDS.map((field) => (
            <Ack key={field} name={field} label={ATTESTATION_COPY[field]} checked={values[field] === "on"} />
          ))}
        </fieldset>
        {errors.acknowledgements ? (
          <p className="text-xs text-bad" role="alert">
            {errors.acknowledgements}
          </p>
        ) : null}
      </section>

      <div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving demo request…" : "Submit demo request"}
        </Button>
        <p className="mt-3 text-xs text-muted">
          Payment is not collected. Access tokens are not stored. This is a local demo of the intake boundary.
        </p>
      </div>
    </form>
  );
}

function Ack({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input type="checkbox" name={name} required className="mt-1 size-4" defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}
