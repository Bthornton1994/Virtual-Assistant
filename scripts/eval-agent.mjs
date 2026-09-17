/**
 * Deterministic agent reliability evaluation CLI.
 * No model calls, network, or production database access.
 *
 * Usage: node --experimental-strip-types scripts/eval-agent.mjs
 *        node --experimental-strip-types scripts/eval-agent.mjs --json
 *        node --experimental-strip-types scripts/eval-agent.mjs --evaluation-clock ISO
 *
 * Report generatedAt is the actual invocation time.
 * Evidence expiry uses DEFAULT_EVALUATION_CLOCK unless --evaluation-clock is set.
 * Invalid evaluation clocks fail closed (non-zero exit); expiry is never skipped.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentEvalExitCode,
  runAgentEval,
  DEFAULT_EVALUATION_CLOCK,
} from "../src/lib/agent-eval/harness.ts";
import {
  EVALUATION_CLOCK_ERROR_CODE,
  validateEvaluationClock,
} from "../src/lib/agent-eval/clock.ts";
import { MemoryTraceSink, setAgentTraceSink } from "../src/lib/agent-trace/sink.ts";

export function resolveEvaluationClockArg(args) {
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

export function runEvalAgentCli(argv = process.argv.slice(2)) {
  const argSet = new Set(argv);
  const jsonOnly = argSet.has("--json");
  const writePath = (() => {
    const index = argv.indexOf("--out");
    if (index === -1) return null;
    return argv[index + 1] ?? null;
  })();

  const clockArg = resolveEvaluationClockArg(argv);
  if (!clockArg.ok) {
    const errorPayload = JSON.stringify({
      ok: false,
      code: clockArg.code,
      reason: clockArg.reason,
    });
    return { exitCode: clockArg.exitCode, output: errorPayload + "\n" };
  }

  const sink = new MemoryTraceSink();
  setAgentTraceSink(sink);

  try {
    const report = runAgentEval({
      evaluationClock: clockArg.clock,
      // generatedAt defaults to actual invocation time inside runAgentEval.
    });

    const payload = JSON.stringify(report, null, 2);

    if (writePath) {
      writeFileSync(resolve(writePath), payload + "\n", "utf8");
    }

    if (jsonOnly) {
      return { exitCode: agentEvalExitCode(report), output: payload + "\n" };
    }

    const lines = [
      `agent-reliability-eval ${report.policyVersion}`,
      `generatedAt: ${report.generatedAt}`,
      `evaluationClock: ${clockArg.clock}`,
      `cases: ${report.summary.passed}/${report.summary.total} passed`,
      `security fixture failures: ${report.summary.securityCaseFailures}`,
      `measures: policy/authority/evidence/approval/lifecycle (not model quality)`,
    ];
    for (const result of report.cases) {
      const mark = result.pass ? "PASS" : "FAIL";
      lines.push(`  [${mark}] ${result.caseId}`);
      for (const reason of result.failureReasons) {
        lines.push(`         - ${reason}`);
      }
    }
    lines.push(`trace events captured: ${sink.list().length} (in-memory only)`);
    return { exitCode: agentEvalExitCode(report), output: lines.join("\n") + "\n" };
  } finally {
    setAgentTraceSink(null);
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("eval-agent.mjs") || entry.includes("/eval-agent.mjs");
})();

if (isDirectRun) {
  const result = runEvalAgentCli();
  if (result.exitCode !== 0 && result.output.includes(EVALUATION_CLOCK_ERROR_CODE)) {
    process.stderr.write(result.output);
  } else {
    process.stdout.write(result.output);
  }
  process.exit(result.exitCode);
}
