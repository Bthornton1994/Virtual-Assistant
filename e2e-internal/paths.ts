import { tmpdir } from "node:os";
import { join } from "node:path";

// Fixed locations for the internal browser journey, all under the system temp
// directory. The global setup wipes and rebuilds them on every run.

export const E2E_ROOT = join(tmpdir(), "rr-internal-e2e");
export const E2E_LOCAL_DIR = join(E2E_ROOT, "store");
export const E2E_ALLOWLIST = join(E2E_ROOT, "allowlist.json");
export const E2E_REPO = join(E2E_ROOT, "repo");
export const E2E_PORT = 3021;
export const E2E_OPERATOR = "E2E Reviewer";
export const E2E_PASSPHRASE = "an e2e passphrase that is long enough";

export const E2E_ENV = {
  RELEASE_RESCUE_INTERNAL: "local",
  RELEASE_RESCUE_LOCAL_DIR: E2E_LOCAL_DIR,
  RELEASE_RESCUE_ALLOWLIST: E2E_ALLOWLIST,
  // The allowlist override is read only in a test-harness process.
  RELEASE_RESCUE_TEST_FIXTURES: "1",
};
