import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  PROMPT_INJECTION,
  fixtureAllowlist,
  makeFixtureRepo,
  writeAllowlist,
} from "../src/lib/__tests__/release-rescue-internal-fixtures";
import { E2E_ALLOWLIST, E2E_ENV, E2E_OPERATOR, E2E_PASSPHRASE, E2E_REPO, E2E_ROOT } from "./paths";

// Builds a throwaway repository with a fabricated credential and an injection
// attempt in it, then registers a reviewer and the clone through the real CLI,
// the way an operator would. Nothing here touches a real repository.

function cli(args: string[], input?: string): void {
  execFileSync("npm", ["run", "--silent", "rr:local", "--", ...args], {
    env: { ...process.env, ...E2E_ENV },
    input,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

export default function globalSetup(): void {
  rmSync(E2E_ROOT, { recursive: true, force: true });
  mkdirSync(E2E_REPO, { recursive: true });
  makeFixtureRepo(
    {
      "src/settings.ts": `export const region = "eu-north-1";\nexport const key = "${FAKE_AWS_KEY}";\n`,
      "README.md": `${PROMPT_INJECTION}\n`,
    },
    { root: E2E_REPO },
  );
  writeAllowlist(E2E_ALLOWLIST, fixtureAllowlist());
  cli(["operator:add", "--name", E2E_OPERATOR], `${E2E_PASSPHRASE}\n`);
  cli(["checkout:set", FIXTURE_REPOSITORY, E2E_REPO]);
}
