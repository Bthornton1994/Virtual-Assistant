"use client";

import { useActionState, useId } from "react";
import { initialRescueIntakeState, submitRescueIntakeAction } from "@/app/actions/ai-app-release-rescue";
import { NonClaimsCallout } from "@/components/ai-app-release-rescue/non-claims";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  ACCESS_GRANT_METHOD_COPY,
  ACCESS_GRANT_METHODS,
  APP_TYPE_COPY,
  APP_TYPES,
} from "@/lib/ai-app-release-rescue/constants";

const selectClassName =
  "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink outline-none ring-accent/30 transition-[border-color,box-shadow] duration-150 ease-[var(--ease-ui-out)] focus:border-accent focus:ring-2 sm:text-sm";

export function RescueIntakeForm() {
  const [state, action, pending] = useActionState(submitRescueIntakeAction, initialRescueIntakeState);
  const errorSummaryId = useId();
  const values = state.values;

  return (
    <form action={action} className="space-y-10" key={state.formError ? JSON.stringify(values) : "fresh"}>
      {state.formError || Object.keys(state.errors).length > 0 ? (
        <div
          id={errorSummaryId}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad"
        >
          {state.formError ?? "Check the highlighted fields. Nothing was stored."}
        </div>
      ) : null}

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Contact</h2>
        <p className="text-sm text-ink-soft">
          Name and work email only. Demo submissions stay in this server’s memory. They are not written to the customer
          database and are not a billing record.
        </p>
        <Field label="Name" error={state.errors.contactName}>
          <Input name="contactName" autoComplete="name" required defaultValue={values.contactName} />
        </Field>
        <Field label="Work email" error={state.errors.workEmail}>
          <Input name="workEmail" type="email" autoComplete="email" required defaultValue={values.workEmail} />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Scope</h2>
        <p className="text-sm text-ink-soft">One repository. One web application. One critical workflow.</p>
        <Field
          label="Repository URL"
          hint="Public https URL. No tokens in the URL. No second repository."
          error={state.errors.repositoryUrl}
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
        <Field label="Web application type" error={state.errors.appType}>
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
          error={state.errors.criticalWorkflow}
        >
          <Textarea
            name="criticalWorkflow"
            required
            placeholder="Staff sign-in through creating an inventory receipt"
            defaultValue={values.criticalWorkflow}
          />
        </Field>
        <Field
          label="Public deployment URL (optional)"
          hint="Used only for observable browser behavior. No login bypass."
          error={state.errors.deploymentUrl}
        >
          <Input
            name="deploymentUrl"
            type="url"
            inputMode="url"
            placeholder="https://app.example.com"
            defaultValue={values.deploymentUrl}
          />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Access</h2>
        <p className="text-sm text-ink-soft">
          Grant read-only access separately — a collaborator invite or a deploy key. This form has no token field
          and will reject pasted secrets.
        </p>
        <Field label="How you will grant read-only access" error={state.errors.accessGrantMethod}>
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
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Evidence notes</h2>
        <p className="text-sm text-ink-soft">
          File contents are not uploaded here. You may name repository-relative files. Do not list .env, keys, or
          credential files, and do not paste values.
        </p>
        <Field label="Notes (optional)" error={state.errors.evidenceNotes}>
          <Textarea
            name="evidenceNotes"
            placeholder="The receipt form is the path we need to ship this week."
            defaultValue={values.evidenceNotes}
          />
        </Field>
        <Field
          label="File names, comma separated (optional)"
          hint="Metadata only. Example: src/app/receipts/new/page.tsx, README.md"
          error={state.errors.evidenceFileNames}
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
          <Ack
            name="acknowledgedNotPenTest"
            label="This review is not a penetration test."
            checked={values.acknowledgedNotPenTest === "on"}
          />
          <Ack
            name="acknowledgedNotCompliance"
            label="This review is not a compliance certification."
            checked={values.acknowledgedNotCompliance === "on"}
          />
          <Ack
            name="acknowledgedNoGuarantee"
            label="This review does not guarantee the absence of security vulnerabilities."
            checked={values.acknowledgedNoGuarantee === "on"}
          />
          <Ack
            name="acknowledgedSingleScope"
            label="Scope is one repository, one web application, and one critical workflow."
            checked={values.acknowledgedSingleScope === "on"}
          />
          <Ack
            name="acknowledgedPointInTime"
            label="Findings apply to the reviewed commit and observed behavior at that time."
            checked={values.acknowledgedPointInTime === "on"}
          />
          <Ack
            name="acknowledgedNoSecretsSubmitted"
            label="I am not submitting tokens, API keys, or environment values on this form."
            checked={values.acknowledgedNoSecretsSubmitted === "on"}
          />
        </fieldset>
        {state.errors.acknowledgements ? (
          <p className="text-xs text-bad" role="alert">
            {state.errors.acknowledgements}
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
