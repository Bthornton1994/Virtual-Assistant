import { beforeEach, describe, expect, it, vi } from "vitest";
import { echoSafeFields } from "@/lib/ai-app-release-rescue/echo-safe-fields";
import { initialRescueIntakeState, MAX_INTAKE_FIELD_LENGTH } from "@/lib/ai-app-release-rescue/intake";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";

const TOKEN = ["gh", "p_", "0123456789abcdefghijklmnopqrstuvwxyz"].join("");

const nextMocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = nextMocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      nextMocks.cookies.set(name, value);
    },
  }),
  headers: async () => ({
    get: (name: string) => nextMocks.headers.get(name) ?? null,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

function formFrom(record: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") form.append(key, value);
  }
  return form;
}

describe("failed intake echo never returns a credential or an oversized field", () => {
  it("replays benign fields and drops a credential-shaped value", () => {
    const form = formFrom({
      contactName: "Dana Petrov",
      workEmail: "dana@harbor-labs.test",
      evidenceNotes: `Use ${TOKEN} to clone it.`,
    });

    const echoed = echoSafeFields(form);

    expect(echoed.contactName).toBe("Dana Petrov");
    expect(echoed.workEmail).toBe("dana@harbor-labs.test");
    expect(echoed).not.toHaveProperty("evidenceNotes");
    expect(JSON.stringify(echoed)).not.toContain(TOKEN);
  });

  it("omits a field longer than the intake bound instead of scanning or echoing it", () => {
    const form = formFrom({
      contactName: "Dana Petrov",
      evidenceNotes: "x".repeat(MAX_INTAKE_FIELD_LENGTH + 1),
    });

    const echoed = echoSafeFields(form);

    expect(echoed.contactName).toBe("Dana Petrov");
    expect(echoed).not.toHaveProperty("evidenceNotes");
    expect(echoed.evidenceNotes).toBeUndefined();
  });

  it("echoes a benign field at the exact length bound", () => {
    const notes = "The assistant drafts the claim before a manager sees it. ".repeat(200).slice(
      0,
      MAX_INTAKE_FIELD_LENGTH,
    );
    expect(notes.length).toBe(MAX_INTAKE_FIELD_LENGTH);

    const echoed = echoSafeFields(formFrom({ evidenceNotes: notes }));

    expect(echoed.evidenceNotes).toBe(notes);
  });

  it("skips non-string FormData entries so a file upload is not echoed as text", () => {
    const form = new FormData();
    form.append("contactName", "Dana Petrov");
    form.append("evidenceNotes", new Blob(["a pasted file"]));

    const echoed = echoSafeFields(form);

    expect(echoed.contactName).toBe("Dana Petrov");
    expect(echoed).not.toHaveProperty("evidenceNotes");
  });

  it("does not echo a field the form never owned, even if a caller posted it", () => {
    const form = formFrom({
      contactName: "Dana Petrov",
      operatorUserId: "e57b0c92-1d48-4a36-b5e0-8f27c4d13a69",
      github_token: TOKEN,
    });

    const echoed = echoSafeFields(form);

    expect(echoed.contactName).toBe("Dana Petrov");
    expect(echoed).not.toHaveProperty("operatorUserId");
    expect(echoed).not.toHaveProperty("github_token");
    expect(JSON.stringify(echoed)).not.toContain(TOKEN);
  });
});

describe("the public intake action uses that echo on a failed parse", () => {
  beforeEach(() => {
    nextMocks.cookies.clear();
    nextMocks.headers.clear();
  });

  it("returns safe field values and never puts the pasted token in the rejection", async () => {
    const { submitRescueIntakeAction } = await import("@/app/actions/ai-app-release-rescue");
    const form = formFrom(
      validIntakeRecord({
        understandsNotPenetrationTest: "",
        evidenceNotes: `Use ${TOKEN} to clone it.`,
      }),
    );

    const result = await submitRescueIntakeAction(initialRescueIntakeState, form);

    expect(result.formError).toBeTruthy();
    expect(result.values.contactName).toBe("Dana Petrov");
    expect(result.values).not.toHaveProperty("evidenceNotes");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(nextMocks.cookies.size).toBe(0);
  });
});
