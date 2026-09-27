import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Where the line D-019 draws actually sits, checked from the files that draw it.
//
// DECISION_LOG.md § D-019: the deterministic work-count tests and every other
// existing test stay release-blocking in `verify`. The wall-clock growth and
// 2,000ms assertions move to a visible, separately named, non-required
// `timing-observation` check whose failure is advisory and is never silently
// retried. D-018 is unchanged: `verify` runs the complete SQL proof suite and
// `proof:claim-guard`. `proof:rr-internal` is a blocking step of that same gate.
// `test:e2e:internal` is a blocking step after the build and the SQL proofs.
// It exercises the local browser journey. It does not make the workflow a
// production deployment.
//
// None of that is visible from inside a test run, so this reads the
// configuration. It cannot see branch protection: whether a check is REQUIRED
// is repository settings, not repository content.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const TIMING_FILE = "src/lib/__tests__/release-rescue-scanner.timing-observation.ts";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [relative(ROOT, path)];
  });
}

/** The `run:` commands of a workflow's steps, in order. */
function runCommands(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*-\s+(?:name: .*\n\s+)?run:\s*(.+)$/gm)].map((match) => match[1].trim());
}

describe("the timing observation is outside the blocking suite, and only it is", () => {
  it("is collected by its own configuration and not by `npm test`", () => {
    const blocking = read("vitest.config.ts");
    const observation = read("vitest.timing-observation.config.ts");

    expect(blocking).toContain('include: ["src/**/*.test.ts"]');
    expect(observation).toContain('include: ["src/**/*.timing-observation.ts"]');
    expect(TIMING_FILE.endsWith(".test.ts")).toBe(false);
    expect(read(TIMING_FILE)).toContain("performance.now()");

    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:timing-observation"]).toBe("vitest run --config vitest.timing-observation.config.ts");
  });

  it("is never retried", () => {
    expect(read("vitest.timing-observation.config.ts")).toMatch(/^\s*retry: 0,$/m);
  });

  it("holds every wall-clock growth and 2,000ms assertion, so none is left blocking", () => {
    // Found by the names of the moved tests. Built rather than written out, so
    // this file does not match itself.
    const movedNames = ["stays linear on", "stays within budget on"].map((name) => `it(\`${name} \${`);
    const blockingTests = sourceFiles(resolve(ROOT, "src")).filter((path) => path.endsWith(".test.ts"));
    expect(blockingTests.length).toBeGreaterThan(0);

    const stillBlocking = blockingTests.filter((path) => movedNames.some((name) => read(path).includes(name)));
    expect(stillBlocking).toEqual([]);

    const observation = read(TIMING_FILE);
    for (const name of movedNames) expect(observation).toContain(name);
    expect(observation).toContain("expect(exceedsGrowthCeiling(timings), detail).toBe(false);");
    expect(observation.match(/\.toBeLessThan\(2_000\)/g)).toHaveLength(2);
  });
});

describe("verify is still the whole release gate", () => {
  const verify = read(".github/workflows/verify.yml");

  it("runs every blocking step, D-018's proofs included, and not the observation", () => {
    expect(runCommands(verify)).toEqual([
      "sudo apt-get update && sudo apt-get install -y postgresql-client",
      "npm ci",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run proof:claim-guard",
      "npm run proof:rr-internal",
      "npm run build",
      "npm run proof:sql",
      "npx playwright install --with-deps chromium",
      "npm run test:e2e:internal",
    ]);
    expect(verify).not.toContain("timing-observation");
  });

  it("does not excuse a failure anywhere in the gate", () => {
    expect(verify).not.toContain("continue-on-error");
    expect(verify).not.toMatch(/\|\|\s*true/);
  });
});

describe("the timing observation is visible, advisory and inert", () => {
  const workflow = read(".github/workflows/timing-observation.yml");

  it("is its own named check, on pull requests only", () => {
    expect(workflow).toMatch(/^name: timing-observation$/m);
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n\n/m);
    for (const trigger of ["schedule", "push", "workflow_run", "cron"]) {
      expect(workflow).not.toMatch(new RegExp(`^\\s+${trigger}:`, "m"));
    }
  });

  it("runs the observation once and lets its failure show", () => {
    expect(workflow.match(/npm run test:timing-observation/g)).toHaveLength(1);
    expect(workflow).not.toContain("--retry");
    // The failing step fails the job. Nothing turns it green.
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).toContain("set -o pipefail");
  });

  it("keeps what it observed, pass or fail", () => {
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
    expect(workflow.match(/if: always\(\)/g)).toHaveLength(2);
  });

  it("can read the repository and do nothing else", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    for (const write of ["issues", "pull-requests", "contents: write", "actions: write", "statuses", "checks"]) {
      expect(workflow).not.toMatch(new RegExp(`^\\s+${write}`, "m"));
    }
    expect(workflow).not.toMatch(/github-script|gh (?:pr|issue|api)|curl /);
  });
});
