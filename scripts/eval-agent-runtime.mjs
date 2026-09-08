/**
 * Runtime-backed agent reliability evaluation CLI.
 *
 * Resolves the `@/` path alias so real repository modules (e.g. execution-context)
 * load under Node type-stripping the same way Vitest does.
 *
 * Usage: node --import ./scripts/alias-loader.mjs --experimental-strip-types scripts/eval-agent-runtime.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runRuntimeAgentEval,
  runtimeAgentEvalExitCode,
} from "../src/lib/agent-eval/runtime/run.ts";
import {
  DEFAULT_EVALUATION_CLOCK,
  EVALUATION_CLOCK_ERROR_CODE,
  validateEvaluationClock,
} from "../src/lib/agent-eval/clock.ts";

export function resolveRuntimeClockArg(args) {
  const index = args.indexOf("--evaluation-clock");
  if (index === -1) {
    return { ok: true, clock: DEFAULT_EVALUATION_CLOCK };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return {
      ok: false,
      code: EVALUATION_CLOCK_ERROR_CODE,
      reason:
        "evaluationClock flag requires an ISO-8601 datetime with offset (example: 2026-09-08T16:00:00.000Z).",
      exitCode: 2,
    };
  }
  const validated = validateEvaluationClock(value);
  if (!validated.ok) {
    return { ok: false, code: validated.code, reason: validated.reason, exitCode: 2 };
  }
  return { ok: true, clock: validated.clock };
}

export function runEvalAgentRuntimeCli(argv = process.argv.slice(2)) {
  const argSet = new Set(argv);
  const jsonOnly = argSet.has("--json");
  const writePath = (() => {
    const index = argv.indexOf("--out");
    if (index === -1) return null;
    return argv[index + 1] ?? null;
  })();

  const clockArg = resolveRuntimeClockArg(argv);
  if (!clockArg.ok) {
    return {
      exitCode: clockArg.exitCode,
      output: JSON.stringify({ ok: false, code: clockArg.code, reason: clockArg.reason }) + "\n",
    };
  }

  const report = runRuntimeAgentEval({
    evaluationClock: clockArg.clock,
  });

  const payload = JSON.stringify(report, null, 2);
  if (writePath) {
    writeFileSync(resolve(writePath), payload + "\n", "utf8");
  }

  if (jsonOnly) {
    return { exitCode: runtimeAgentEvalExitCode(report), output: payload + "\n" };
  }

  const lines = [
    `agent-reliability-eval-runtime ${report.harness.suite}`,
    `generatedAt: ${report.generatedAt}`,
    `evaluationClock: ${clockArg.clock}`,
    `cases: ${report.summary.passed}/${report.summary.total} passed`,
    `security fixture failures: ${report.summary.securityCaseFailures}`,
    `suite separation: runtime (not fixture); fixture suite remains npm run eval:agent`,
  ];
  for (const result of report.cases) {
    const mark = result.pass ? "PASS" : "FAIL";
    lines.push(`  [${mark}] ${result.caseId}`);
    for (const reason of result.failureReasons) {
      lines.push(`         - ${reason}`);
    }
  }
  return { exitCode: runtimeAgentEvalExitCode(report), output: lines.join("\n") + "\n" };
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("eval-agent-runtime.mjs") || entry.includes("/eval-agent-runtime.mjs");
})();

if (isDirectRun) {
  const result = runEvalAgentRuntimeCli();
  if (result.exitCode !== 0 && result.output.includes(EVALUATION_CLOCK_ERROR_CODE)) {
    process.stderr.write(result.output);
  } else {
    process.stdout.write(result.output);
  }
  process.exit(result.exitCode);
}
